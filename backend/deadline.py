"""
Deadline render farm integration.

Submission side  — runs on the existing RP Interface FastAPI (workstation / RunPod):
  POST /api/deadline/submit       called by Electron UI
  GET  /api/deadline/status/{id}  called by Electron UI (polling)

Worker side  — runs on the ComfyUI FastAPI *inside the Docker container on each worker*:
  POST /api/deadline/execute      called by run_job.py on the Deadline worker host
"""

import asyncio
import base64
import json
import shutil
import uuid
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import APIRouter, Form, HTTPException, UploadFile, File
from pydantic import BaseModel

import comfy_client
import tools as tools_module
from workflows.image_prompting.image_prompting import load_image_prompting

import logging
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/deadline", tags=["deadline"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEADLINE_URL = "http://192.168.1.193:8081"
DEADLINE_POOL = "aitool"
NAS_JOBS_DIR = Path(r"\\nas\indgai\deadline_jobs")
NAS_COMFYUI_OUTPUT = Path(r"\\nas\indgai\comfyui_output")

# Deadline job status int → human string (Deadline 10 REST API)
_STATUS_MAP = {
    0: "unknown",
    1: "queued",
    2: "suspended",
    3: "rendering",
    4: "completed",
    5: "failed",
    6: "failed",
}

POLL_INTERVAL = 5   # seconds between ComfyUI history polls during execute
POLL_TIMEOUT = 600  # max seconds to wait for a workflow to finish


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class SubmitRequest(BaseModel):
    tool_id: str
    params: dict = {}
    path_client: str = ""
    path_product: str = ""
    path_filename: str = ""
    priority: int = 50


class ExecuteRequest(BaseModel):
    """Sent by run_job.py on the worker host to the local worker FastAPI."""
    job_id: str
    tool_id: Optional[str] = None
    workflow_type: Optional[str] = None  # e.g. "image_prompting" for built-in modules
    params: dict = {}
    # field_id -> {"data": "<base64>", "filename": "image.png"}
    images_b64: dict = {}
    path_client: str = ""
    path_product: str = ""
    path_filename: str = ""
    output_path: str  # NAS path — worker host handles copying, not us


# ---------------------------------------------------------------------------
# Submission-side endpoints
# ---------------------------------------------------------------------------

@router.post("/submit")
async def submit_job(
    tool_id: str = Form(""),
    workflow_type: str = Form(""),
    params: str = Form("{}"),
    path_client: str = Form(""),
    path_product: str = Form(""),
    path_filename: str = Form(""),
    priority: int = Form(50),
    images: Optional[List[UploadFile]] = None,
):
    """
    Stage inputs to NAS and submit a ComfyUI job to Deadline.
    Images are passed as multipart files named after their field IDs.
    """
    job_id = str(uuid.uuid4())
    job_dir = NAS_JOBS_DIR / job_id
    inputs_dir = job_dir / "inputs"
    outputs_dir = job_dir / "outputs"

    try:
        inputs_dir.mkdir(parents=True, exist_ok=True)
        outputs_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Cannot create job directory on NAS: {e}")

    try:
        params_dict = json.loads(params)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="params must be valid JSON")

    # Stage uploaded images to NAS
    image_paths: dict[str, str] = {}
    for upload in (images or []):
        data = await upload.read()
        dest = inputs_dir / upload.filename
        dest.write_bytes(data)
        # field_id is encoded in the filename as "{field_id}__{original_name}"
        # e.g.  "input_image__photo.png"  → field_id = "input_image"
        field_id = upload.filename.split("__")[0] if "__" in upload.filename else upload.filename
        image_paths[field_id] = str(dest)

    job_data = {
        "job_id": job_id,
        "tool_id": tool_id or None,
        "workflow_type": workflow_type or None,
        "params": params_dict,
        "image_paths": image_paths,
        "path_client": path_client,
        "path_product": path_product,
        "path_filename": path_filename,
        "output_path": str(outputs_dir),
        "nas_comfyui_output": str(NAS_COMFYUI_OUTPUT),
    }

    job_json_path = job_dir / "job.json"
    job_json_path.write_text(json.dumps(job_data, indent=2), encoding="utf-8")

    deadline_payload = {
        "JobInfo": {
            "Name": f"ComfyUI – {workflow_type or tool_id or 'job'} – {job_id[:8]}",
            "Plugin": "ComfyUI",
            "Pool": DEADLINE_POOL,
            "Frames": "0",
            "Priority": priority,
            "Comment": f"RP Interface job {job_id}",
        },
        "PluginInfo": {
            "JobDataPath": str(job_json_path),
        },
        "AuxFiles": [],
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{DEADLINE_URL}/api/jobs", json=deadline_payload)
            r.raise_for_status()
            deadline_response = r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Deadline Web Service error: {e}")

    deadline_job_id = deadline_response.get("_id", "")
    logger.info(f"[deadline] Submitted job {job_id} → Deadline job {deadline_job_id}")

    return {
        "job_id": job_id,
        "deadline_job_id": deadline_job_id,
    }


@router.get("/status/{deadline_job_id}")
async def get_job_status(deadline_job_id: str):
    """Poll Deadline for job status. Returns a simplified status + raw Deadline data."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{DEADLINE_URL}/api/jobs/{deadline_job_id}")
            r.raise_for_status()
            job = r.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Deadline Web Service error: {e}")

    props = job.get("Props", {})
    status_int = props.get("Stat", 0)
    status_str = _STATUS_MAP.get(status_int, "unknown")
    progress = props.get("Prog", 0.0)

    return {
        "deadline_job_id": deadline_job_id,
        "status": status_str,
        "progress": progress,
        "raw": job,
    }


# ---------------------------------------------------------------------------
# Worker-side endpoint  (runs inside Docker on each Deadline worker)
# ---------------------------------------------------------------------------

@router.post("/execute")
async def execute_job(body: ExecuteRequest):
    """
    Execute a ComfyUI workflow locally. Called by run_job.py on the worker host.
    Uploads images to the local ComfyUI, runs the workflow, waits for completion.
    Returns output filenames so run_job.py can copy them from the NAS output volume.
    """
    if body.workflow_type == "image_prompting":
        return await _execute_image_prompting(body)
    elif body.tool_id:
        return await _execute_custom_tool(body)
    else:
        raise HTTPException(status_code=422, detail="Either workflow_type or tool_id is required")


async def _upload_images_b64(images_b64: dict) -> dict[str, str]:
    """Upload base64 images to local ComfyUI. Returns {field_id: comfy_filename}."""
    result: dict[str, str] = {}
    for field_id, img_info in images_b64.items():
        try:
            img_bytes = base64.b64decode(img_info["data"])
            original_name = img_info.get("filename", f"{field_id}.png")
            result[field_id] = await comfy_client.upload_image(img_bytes, original_name)
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Image upload failed for '{field_id}': {e}")
    return result


async def _poll_prompt_ids(prompt_ids: list[str], job_id: str) -> list[str]:
    """Poll ComfyUI history until all prompt_ids complete. Returns output filenames."""
    output_filenames: list[str] = []
    remaining = set(prompt_ids)
    deadline_ts = asyncio.get_event_loop().time() + POLL_TIMEOUT

    while remaining and asyncio.get_event_loop().time() < deadline_ts:
        await asyncio.sleep(POLL_INTERVAL)
        for pid in list(remaining):
            try:
                history = await comfy_client.get_history(pid)
            except Exception:
                continue
            entry = history.get(pid, {})
            if not entry:
                continue
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                logger.error(f"[deadline/execute] Prompt {pid} errored for job {job_id}")
                remaining.discard(pid)
                continue
            if status.get("completed"):
                for node_output in entry.get("outputs", {}).values():
                    for img in node_output.get("images", []):
                        if img.get("type") == "output":
                            output_filenames.append(img["filename"])
                remaining.discard(pid)

    if remaining:
        raise HTTPException(status_code=504, detail=f"Workflow timed out after {POLL_TIMEOUT}s")

    logger.info(f"[deadline/execute] Job {job_id} complete — {len(output_filenames)} output(s)")
    return output_filenames


async def _execute_image_prompting(body: ExecuteRequest) -> dict:
    comfy_names = await _upload_images_b64(body.images_b64)

    # Reconstruct ordered ref_images list from ref_0, ref_1, ref_2, ref_3
    ref_images = [comfy_names[f"ref_{i}"] for i in range(4) if f"ref_{i}" in comfy_names]

    params = body.params
    count = max(1, int(params.get("count", 1)))
    prompt = params.get("prompt", "")
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")

    prompt_ids: list[str] = []
    for run in range(1, count + 1):
        prefix = params.get("filename_prefix", "Shot001")
        if count > 1:
            prefix = f"{prefix}_r{run:02d}_"
        try:
            workflow = load_image_prompting(
                ref_images=ref_images,
                prompt=prompt,
                client_path=params.get("client_path", ""),
                product_path=params.get("product_path", ""),
                filename_prefix=prefix,
                username="deadline",
            )
            prompt_id = await comfy_client.queue_workflow(workflow, str(uuid.uuid4()))
            prompt_ids.append(prompt_id)
            logger.info(f"[deadline/execute] image_prompting run {run}/{count} → {prompt_id}")
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Workflow queue error run {run}: {e}")

    output_filenames = await _poll_prompt_ids(prompt_ids, body.job_id)
    return {"output_paths": output_filenames}


async def _execute_custom_tool(body: ExecuteRequest) -> dict:
    tool = tools_module.load_tool(body.tool_id)
    comfy_names = await _upload_images_b64(body.images_b64)

    values = dict(body.params)
    values.update(comfy_names)
    if body.path_client:
        values["__path_client"] = body.path_client
    if body.path_product:
        values["__path_product"] = body.path_product
    if body.path_filename:
        values["__path_filename"] = body.path_filename

    try:
        workflow = tools_module.apply_patches(tool, values)
        prompt_id = await comfy_client.queue_workflow(workflow, str(uuid.uuid4()))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Workflow error: {e}")

    logger.info(f"[deadline/execute] custom tool queued {prompt_id} for job {body.job_id}")
    output_filenames = await _poll_prompt_ids([prompt_id], body.job_id)
    return {"output_paths": output_filenames}
