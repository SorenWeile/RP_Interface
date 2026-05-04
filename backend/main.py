from dotenv import load_dotenv
load_dotenv()  # loads backend/.env before any other module reads env vars

import io
import re
import sys
import subprocess
import os
import uuid
import json
import zipfile
import datetime
import asyncio
import httpx
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Request, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Header
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import comfy_client
from workflows.upscale_rework.upscale_rework import load_upscale_rework
from workflows.magnific_upscaler.magnific_upscaler import load_magnific_upscaler
from workflows.outfit_swapping.outfit_swapping import load_outfit_swapping
from workflows.panorama.panorama import load_panorama
from workflows.image_edit.image_edit import load_image_edit
from workflows.image_prompting.image_prompting import load_image_prompting
from workflows.video_creation.video_creation import load_video_creation, MIN_LENGTH, MAX_LENGTH
import gallery as gallery_module
from gallery import _strip_png_metadata
import user_management as user_mgmt_module
import tools as tools_module
import sync as sync_module
import deadline as deadline_module
from config import (
    UPSCALE_REWORK_MODELS,
    DEFAULT_PANORAMA_PROMPT,
    DEFAULT_CLIENT_PATH,
    DEFAULT_PRODUCT_PATH,
    DEFAULT_FILENAME_PREFIX,
    MIN_RUNS_PER_MODEL,
    MAX_RUNS_PER_MODEL,
    MIN_BATCH_COUNT,
    MAX_BATCH_COUNT,
    COMFYUI_HOST,
    COMFYUI_TIMEOUT,
    ALLOWED_IMAGE_EXTENSIONS,
    MAX_HISTORY_ITEMS,
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AI Toolhouse")
app.include_router(gallery_module.router)
app.include_router(user_mgmt_module.router)
app.include_router(user_mgmt_module.auth_router)
app.include_router(tools_module.router)
app.include_router(sync_module.router)
app.include_router(deadline_module.router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Startup check
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def on_startup():
    # Authenticate NAS share on Windows if credentials are configured
    if sys.platform == "win32":
        nas_share    = os.getenv("NAS_SHARE", "")
        nas_user     = os.getenv("NAS_USERNAME", "")
        nas_password = os.getenv("NAS_PASSWORD", "")
        if nas_share and nas_user and nas_password:
            result = subprocess.run(
                ["net", "use", nas_share, f"/user:{nas_user}", nas_password],
                capture_output=True, text=True,
            )
            if result.returncode == 0:
                logger.info(f"NAS share authenticated: {nas_share}")
            else:
                logger.warning(f"net use failed for {nas_share}: {result.stderr.strip()}")

    # ComfyUI reachability check
    host = os.getenv("COMFYUI_HOST", COMFYUI_HOST)
    url = f"http://{host}"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, timeout=COMFYUI_TIMEOUT)
            if r.status_code < 500:
                logger.info(f"ComfyUI reachable at {url}")
            else:
                logger.warning(f"ComfyUI returned {r.status_code}")
    except Exception as e:
        logger.warning(f"Could not reach ComfyUI at {url}: {e}")

    # Initialise gallery DB
    try:
        gallery_module.init_gallery_db()
    except Exception as e:
        logger.warning(f"Gallery DB init failed: {e}")

    # Initialise user management DB
    try:
        user_mgmt_module.init_user_db()
    except Exception as e:
        logger.warning(f"User DB init failed: {e}")

    # Initialise tools DB (creates tables + seeds built-in tools)
    try:
        tools_module.init_tools_db()
    except Exception as e:
        logger.warning(f"Tools DB init failed: {e}")



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_resolve_username = user_mgmt_module.resolve_username


def _validate_image(filename: str) -> None:
    """Raise HTTP 422 if filename is empty, non-string, or has an unsupported extension."""
    if not filename or not isinstance(filename, str):
        raise HTTPException(422, f"Invalid image filename: {filename}")
    if not any(filename.lower().endswith(ext) for ext in ALLOWED_IMAGE_EXTENSIONS):
        raise HTTPException(422, f"Unsupported image format: {filename}")


# ---------------------------------------------------------------------------
# Batch data model & in-memory store
# ---------------------------------------------------------------------------

@dataclass
class BatchJob:
    prompt_id: str
    client_id: str
    model: str
    run_index: int


@dataclass
class Batch:
    id: str
    filename: str
    client_path: str
    product_path: str
    filename_prefix: str
    runs_per_model: int
    jobs: List[BatchJob]
    created_at: str
    cleanup_queued: bool = field(default=False)


# In-memory store — keyed by batch_id.
# Fine for a single-pod tool; no persistence needed across restarts.
_batches: dict = {}

_CLEANUP_WORKFLOW_PATH = Path(__file__).parent / "workflows" / "cleanup" / "Cleaner_API_V1.json"


async def _queue_cleanup() -> None:
    """Queue the RAM cleanup workflow on ComfyUI. Fire-and-forget."""
    if not _CLEANUP_WORKFLOW_PATH.exists():
        logger.warning(f"Cleanup workflow not found: {_CLEANUP_WORKFLOW_PATH}")
        return
    try:
        workflow = json.loads(_CLEANUP_WORKFLOW_PATH.read_text())
        client_id = str(uuid.uuid4())
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[cleanup] queued RAM cleanup workflow → {prompt_id}")
    except Exception as e:
        logger.warning(f"[cleanup] failed to queue cleanup workflow: {e}")


def _dated_product_path(product_path: str, workflow_tag: str) -> str:
    """Append a YYYY_MM_DD_WorkflowTag subfolder to the product path."""
    date = datetime.date.today().strftime("%Y_%m_%d")
    return f"{product_path}/{date}_{workflow_tag}"


def _job_status(entry: dict) -> str:
    """Derive a job status string from a ComfyUI history entry."""
    s = entry.get("status", {})
    if s.get("status_str") == "error":
        return "error"
    if s.get("completed", False):
        return "done"
    return "processing"


def _job_images(entry: dict) -> list:
    images = []
    for node_output in entry.get("outputs", {}).values():
        images.extend(img for img in node_output.get("images", []) if img.get("type") == "output")
    return images


# ---------------------------------------------------------------------------
# Storage status
# ---------------------------------------------------------------------------

def _normalize(path: str) -> str:
    """Normalize all backslashes to forward slashes."""
    return path.replace("\\", "/")


def _storage_label(path: str) -> str:
    p = _normalize(path)
    if p.startswith("//"):
        return "NAS"
    if any(p.startswith(x) for x in ("/runpod", "/workspace", "/volume")):
        return "Volume"
    if p.startswith("/nas") or p.startswith("/mnt"):
        return "NAS"
    return "Local"


def _accessible(path: str) -> bool:
    """Check whether a storage path is reachable.

    For UNC paths (\\server\share\sub) we probe the share root rather than the
    subdirectory — the sub-folder may not exist yet on a fresh setup even though
    the NAS itself is perfectly accessible.
    """
    if not path:
        return False
    try:
        p = _normalize(path)
        if p.startswith("//"):
            parts = p.lstrip("/").split("/")
            if len(parts) >= 2:
                # Reconstruct Windows UNC share root: \\server\share
                share_root = "\\\\" + parts[0] + "\\" + parts[1]
                return os.path.isdir(share_root)
        return os.path.isdir(path)
    except Exception:
        return False


@app.get("/api/storage/status")
def storage_status():
    output_dir = os.getenv("COMFYUI_OUTPUT_DIR", "/workspace/ComfyUI/output")
    db_dir     = os.getenv("DB_DIR", "")

    return {
        "output": {"path": output_dir, "ok": _accessible(output_dir), "label": _storage_label(output_dir)},
        "db":     {"path": db_dir,     "ok": _accessible(db_dir) if db_dir else None,
                   "label": _storage_label(db_dir) if db_dir else None},
    }


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    try:
        data = await file.read()
        assigned_name = await comfy_client.upload_image(data, file.filename or "upload.png")
        return {"filename": assigned_name}
    except Exception as e:
        logger.error(f"[upload] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Magnific Upscaler ─────────────────────────────────────────────────────────

class MagnificUpscalerParams(BaseModel):
    filename: str
    sharpen: int = 7
    smart_grain: int = 7
    ultra_detail: int = 30
    scale_factor: str = "4x"   # "2x" | "4x" | "8x" | "16x"
    client_path: str
    product_path: str
    filename_prefix: str


@app.post("/api/workflow/magnific_upscaler")
async def run_magnific_upscaler(params: MagnificUpscalerParams, x_user_token: Optional[str] = Header(None)):
    if not params.filename:
        raise HTTPException(422, "filename is required")
    if params.scale_factor not in {"2x", "4x", "8x", "16x"}:
        raise HTTPException(422, "scale_factor must be one of 2x, 4x, 8x, 16x")
    _validate_image(params.filename)
    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_magnific_upscaler(
            filename=params.filename,
            sharpen=params.sharpen,
            smart_grain=params.smart_grain,
            ultra_detail=params.ultra_detail,
            scale_factor=params.scale_factor,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Magnific_Upscaler"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[magnific_upscaler] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        logger.error(f"[magnific_upscaler] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Upscale Rework — batch creation ───────────────────────────────────────────

class UpscaleReworkParams(BaseModel):
    filename: str
    models: List[str]           # subset of UPSCALE_REWORK_MODELS
    runs_per_model: int = 4
    client_path: str            # 95_CLIENT_PATH  e.g. "Deployed/HD"
    product_path: str           # 96_PRODUCT_PATH e.g. "ProjectName"
    filename_prefix: str        # 97_FILENAME     e.g. "Shot001"


@app.post("/api/workflow/upscale_rework")
async def run_upscale_rework(params: UpscaleReworkParams, x_user_token: Optional[str] = Header(None)):
    if not params.models:
        raise HTTPException(422, "Select at least one model")
    invalid = [m for m in params.models if m not in UPSCALE_REWORK_MODELS]
    if invalid:
        raise HTTPException(422, f"Unknown model(s): {invalid}")
    if not MIN_RUNS_PER_MODEL <= params.runs_per_model <= MAX_RUNS_PER_MODEL:
        raise HTTPException(422, "runs_per_model must be between 1 and 10")
    _validate_image(params.filename)

    username = _resolve_username(x_user_token)
    batch_id = str(uuid.uuid4())
    jobs: List[BatchJob] = []
    errors: List[str] = []
    product_path = _dated_product_path(params.product_path, "Upscaler")

    await _queue_cleanup()

    for model in params.models:
        for run in range(1, params.runs_per_model + 1):
            try:
                client_id = str(uuid.uuid4())
                workflow = load_upscale_rework(
                    filename=params.filename,
                    model_name=model,
                    run_index=run,
                    client_path=params.client_path,
                    product_path=product_path,
                    filename_prefix=params.filename_prefix,
                    username=username,
                )
                prompt_id = await comfy_client.queue_workflow(workflow, client_id)
                jobs.append(BatchJob(
                    prompt_id=prompt_id,
                    client_id=client_id,
                    model=model,
                    run_index=run,
                ))
                logger.info(f"[batch:{batch_id}] queued {model} run {run} → {prompt_id}")
            except Exception as e:
                msg = f"{model} run {run}: {type(e).__name__}: {e}"
                logger.error(f"[batch:{batch_id}] ERROR queuing {msg}")
                errors.append(msg)

    if not jobs:
        raise HTTPException(422, f"All jobs failed to queue: {errors}")

    _batches[batch_id] = Batch(
        id=batch_id,
        filename=params.filename,
        client_path=params.client_path,
        product_path=product_path,
        filename_prefix=params.filename_prefix,
        runs_per_model=params.runs_per_model,
        jobs=jobs,
        created_at=datetime.datetime.utcnow().isoformat() + "Z",
    )

    return {
        "batch_id": batch_id,
        "total": len(jobs),
        "queuing_errors": errors,
        "jobs": [
            {
                "prompt_id": j.prompt_id,
                "client_id": j.client_id,
                "model": j.model,
                "run": j.run_index,
            }
            for j in jobs
        ],
    }


# ── Batch status ───────────────────────────────────────────────────────────────

@app.get("/api/batch/{batch_id}")
async def get_batch_status(batch_id: str):
    batch = _batches.get(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Two ComfyUI calls regardless of batch size:
    # 1) all completed history, 2) current queue state
    try:
        history = await comfy_client.get_all_history(max_items=MAX_HISTORY_ITEMS)
    except Exception:
        history = {}

    try:
        queue = await comfy_client.get_queue()
        running_ids: set = queue["running"]
        pending_ids: set = queue["pending"]
    except Exception:
        running_ids = set()
        pending_ids = set()

    counts = {"queued": 0, "processing": 0, "done": 0, "error": 0}
    job_statuses = []

    for job in batch.jobs:
        entry = history.get(job.prompt_id)
        if entry:
            status = _job_status(entry)
            images = _job_images(entry)
        elif job.prompt_id in running_ids:
            status = "processing"
            images = []
        else:
            # In pending queue or not yet picked up — treat as queued
            status = "queued"
            images = []

        counts[status] = counts.get(status, 0) + 1
        job_statuses.append({
            "prompt_id": job.prompt_id,
            "client_id": job.client_id,
            "model": job.model,
            "run": job.run_index,
            "status": status,
            "images": images,
        })

    # Queue RAM cleanup once when all jobs have finished (done or error).
    active = counts["queued"] + counts["processing"]
    if active == 0 and not batch.cleanup_queued:
        batch.cleanup_queued = True
        asyncio.create_task(_queue_cleanup())

    return {
        "batch_id": batch_id,
        "filename": batch.filename,
        "total": len(batch.jobs),
        "queued": counts["queued"],
        "processing": counts["processing"],
        "done": counts["done"],
        "error": counts["error"],
        "created_at": batch.created_at,
        "jobs": job_statuses,
    }


# ── Batch cancel ───────────────────────────────────────────────────────────────

@app.post("/api/batch/{batch_id}/cancel")
async def cancel_batch(batch_id: str):
    batch = _batches.get(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Find which of our jobs are still pending in the ComfyUI queue
    try:
        queue = await comfy_client.get_queue()
        pending_ids: set = queue["pending"]
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")

    to_cancel = [j.prompt_id for j in batch.jobs if j.prompt_id in pending_ids]
    await comfy_client.cancel_queue_items(to_cancel)

    logger.info(f"[batch:{batch_id}] cancelled {len(to_cancel)} pending job(s)")
    return {"batch_id": batch_id, "cancelled": len(to_cancel)}


# ── Batch download ─────────────────────────────────────────────────────────────

@app.get("/api/batch/{batch_id}/download")
async def download_batch_zip(batch_id: str):
    batch = _batches.get(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    try:
        history = await comfy_client.get_all_history(max_items=MAX_HISTORY_ITEMS)
    except Exception as e:
        raise HTTPException(502, f"Could not reach ComfyUI: {e}")

    image_refs = []
    for job in batch.jobs:
        entry = history.get(job.prompt_id)
        if entry:
            image_refs.extend(_job_images(entry))

    if not image_refs:
        raise HTTPException(404, "No completed images found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
        for img in image_refs:
            try:
                data = await comfy_client.get_image(
                    img["filename"], img.get("subfolder", ""), img.get("type", "output")
                )
                # Strip metadata from PNG files
                if img["filename"].lower().endswith('.png'):
                    data = _strip_png_metadata(data)
                zf.writestr(img["filename"], data)
            except Exception as e:
                logger.warning(f"[download:{batch_id}] could not fetch {img['filename']}: {e}")

    buf.seek(0)
    prefix = batch.filename_prefix or "batch"
    zip_name = f"{prefix}_{batch_id[:8]}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_name}"'},
    )


# ── Outfit Swapping ────────────────────────────────────────────────────────────

class OutfitSwappingParams(BaseModel):
    main_image: str           # 11_INPUT_IMAGE_LATENT
    ref_images: List[str]     # up to 6 reference image filenames
    prompt: str               # 05_PROMPT_POSITIVE_INSTRUCTION (goes to node 30)
    client_path: str          # 95_CLIENT_PATH
    product_path: str         # 96_PRODUCT_PATH
    filename_prefix: str      # 97_FILENAME


@app.post("/api/workflow/outfit_swapping")
async def run_outfit_swapping(params: OutfitSwappingParams, x_user_token: Optional[str] = Header(None)):
    if not params.main_image:
        raise HTTPException(422, "main_image is required")
    if len(params.ref_images) > 6:
        raise HTTPException(422, "At most 6 reference images are supported")
    
    for img_filename in [params.main_image] + params.ref_images:
        _validate_image(img_filename)

    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_outfit_swapping(
            main_image=params.main_image,
            ref_images=params.ref_images,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Outfit_Swapping"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[outfit_swapping] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[outfit_swapping] ERROR: {type(e).__name__}: {e}")
        
        # Provide more specific error messages for common issues
        if "Invalid image file" in error_msg:
            invalid_files = re.findall(r'Invalid image file: ([^\']+)', error_msg)
            if invalid_files:
                raise HTTPException(
                    status_code=400,
                    detail=f"The following images could not be loaded by ComfyUI. "
                          f"Please ensure these files were uploaded successfully: {', '.join(invalid_files)}"
                )

        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Panorama Outpainting ───────────────────────────────────────────────────────

class PanoramaParams(BaseModel):
    state_json: str           # full PanoramaStickers editor state from the frontend
    prompt: str = DEFAULT_PANORAMA_PROMPT
    client_path: str = DEFAULT_CLIENT_PATH
    product_path: str = DEFAULT_PRODUCT_PATH
    filename_prefix: str = DEFAULT_FILENAME_PREFIX


@app.post("/api/workflow/panorama")
async def run_panorama(params: PanoramaParams, x_user_token: Optional[str] = Header(None)):
    if not params.state_json:
        raise HTTPException(422, "state_json is required")
    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_panorama(
            state_json=params.state_json,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Panorama"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[panorama] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        logger.error(f"[panorama] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Image Edit ────────────────────────────────────────────────────────────────

class ImageEditParams(BaseModel):
    filename: str             # 11_INPUT_IMAGE_LATENT
    prompt: str               # 05_PROMPT_INSTRUCTION
    ref_images: List[str] = []  # Up to 4 reference image filenames
    client_path: str          # 95_CLIENT_PATH
    product_path: str         # 96_PRODUCT_PATH
    filename_prefix: str      # 97_FILENAME


@app.post("/api/workflow/image_edit")
async def run_image_edit(params: ImageEditParams, x_user_token: Optional[str] = Header(None)):
    if not params.filename:
        raise HTTPException(422, "filename is required")
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    if len(params.ref_images) > 4:
        raise HTTPException(422, "At most 4 reference images are supported")
    
    for img_filename in [params.filename] + params.ref_images:
        _validate_image(img_filename)

    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_image_edit(
            filename=params.filename,
            prompt=params.prompt,
            ref_images=params.ref_images,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Image_Edit"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[image_edit] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[image_edit] ERROR: {type(e).__name__}: {e}")
        
        # Provide more specific error messages for common issues
        if "Invalid image file" in error_msg:
            invalid_files = re.findall(r'Invalid image file: ([^\']+)', error_msg)
            if invalid_files:
                raise HTTPException(
                    status_code=400,
                    detail=f"The following images could not be loaded by ComfyUI. "
                          f"Please ensure these files were uploaded successfully: {', '.join(invalid_files)}"
                )

        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Image Edit — batch ────────────────────────────────────────────────────────

class ImageEditBatchParams(BaseModel):
    filename: str
    prompt: str
    ref_images: List[str] = []  # Up to 4 reference image filenames
    count: int = 1             # 1–10 runs
    client_path: str
    product_path: str
    filename_prefix: str


@app.post("/api/workflow/image_edit/batch")
async def run_image_edit_batch(params: ImageEditBatchParams, x_user_token: Optional[str] = Header(None)):
    if not params.filename:
        raise HTTPException(422, "filename is required")
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    if len(params.ref_images) > 4:
        raise HTTPException(422, "At most 4 reference images are supported")
    if not MIN_BATCH_COUNT <= params.count <= MAX_BATCH_COUNT:
        raise HTTPException(422, "count must be between 1 and 10")

    for img_filename in [params.filename] + params.ref_images:
        _validate_image(img_filename)

    username = _resolve_username(x_user_token)
    batch_id = str(uuid.uuid4())
    jobs: List[BatchJob] = []
    errors: List[str] = []
    product_path = _dated_product_path(params.product_path, "Image_Edit")

    await _queue_cleanup()

    for run in range(1, params.count + 1):
        try:
            client_id = str(uuid.uuid4())
            # Append run suffix only when count > 1 to keep single-run paths clean
            prefix = f"{params.filename_prefix}_r{run:02d}_" if params.count > 1 else params.filename_prefix
            workflow = load_image_edit(
                filename=params.filename,
                prompt=params.prompt,
                ref_images=params.ref_images,
                client_path=params.client_path,
                product_path=product_path,
                filename_prefix=prefix,
                username=username,
            )
            prompt_id = await comfy_client.queue_workflow(workflow, client_id)
            jobs.append(BatchJob(
                prompt_id=prompt_id,
                client_id=client_id,
                model="image_edit",
                run_index=run,
            ))
            logger.info(f"[image_edit_batch:{batch_id}] queued run {run} → {prompt_id}")
        except Exception as e:
            msg = f"run {run}: {type(e).__name__}: {e}"
            logger.error(f"[image_edit_batch:{batch_id}] ERROR: {msg}")
            errors.append(msg)

    if not jobs:
        raise HTTPException(422, f"All jobs failed to queue: {errors}")

    _batches[batch_id] = Batch(
        id=batch_id,
        filename=params.filename,
        client_path=params.client_path,
        product_path=product_path,
        filename_prefix=params.filename_prefix,
        runs_per_model=params.count,
        jobs=jobs,
        created_at=datetime.datetime.utcnow().isoformat() + "Z",
    )

    return {"batch_id": batch_id, "total": len(jobs), "queuing_errors": errors}


# ── Image Prompting ───────────────────────────────────────────────────────────

class ImagePromptingParams(BaseModel):
    ref_images: List[str]        # up to 4 reference image filenames
    prompt: str                  # 05_PROMPT_INSTRUCTION
    client_path: str             # 95_CLIENT_PATH
    product_path: str            # 96_PRODUCT_PATH
    filename_prefix: str         # 97_FILENAME


@app.post("/api/workflow/image_prompting")
async def run_image_prompting(params: ImagePromptingParams, x_user_token: Optional[str] = Header(None)):
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    if len(params.ref_images) > 4:
        raise HTTPException(422, "At most 4 reference images are supported")

    for img_filename in params.ref_images:
        _validate_image(img_filename)

    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_image_prompting(
            ref_images=params.ref_images,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Image_Prompting"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[image_prompting] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        logger.error(f"[image_prompting] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Image Prompting — batch ───────────────────────────────────────────────────

class ImagePromptingBatchParams(BaseModel):
    ref_images: List[str]        # up to 4 reference image filenames
    prompt: str                  # 05_PROMPT_INSTRUCTION
    count: int = 1               # 1–10 runs
    client_path: str
    product_path: str
    filename_prefix: str


@app.post("/api/workflow/image_prompting/batch")
async def run_image_prompting_batch(params: ImagePromptingBatchParams, x_user_token: Optional[str] = Header(None)):
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    if len(params.ref_images) > 4:
        raise HTTPException(422, "At most 4 reference images are supported")
    if not MIN_BATCH_COUNT <= params.count <= MAX_BATCH_COUNT:
        raise HTTPException(422, "count must be between 1 and 10")

    for img_filename in params.ref_images:
        _validate_image(img_filename)

    username = _resolve_username(x_user_token)
    batch_id = str(uuid.uuid4())
    jobs: List[BatchJob] = []
    errors: List[str] = []
    product_path = _dated_product_path(params.product_path, "Image_Prompting")

    await _queue_cleanup()

    for run in range(1, params.count + 1):
        try:
            client_id = str(uuid.uuid4())
            prefix = f"{params.filename_prefix}_r{run:02d}_" if params.count > 1 else params.filename_prefix
            workflow = load_image_prompting(
                ref_images=params.ref_images,
                prompt=params.prompt,
                client_path=params.client_path,
                product_path=product_path,
                filename_prefix=prefix,
                username=username,
            )
            prompt_id = await comfy_client.queue_workflow(workflow, client_id)
            jobs.append(BatchJob(
                prompt_id=prompt_id,
                client_id=client_id,
                model="image_prompting",
                run_index=run,
            ))
            logger.info(f"[image_prompting_batch:{batch_id}] queued run {run} → {prompt_id}")
        except Exception as e:
            msg = f"run {run}: {type(e).__name__}: {e}"
            logger.error(f"[image_prompting_batch:{batch_id}] ERROR: {msg}")
            errors.append(msg)

    if not jobs:
        raise HTTPException(422, f"All jobs failed to queue: {errors}")

    _batches[batch_id] = Batch(
        id=batch_id,
        filename=params.filename_prefix,
        client_path=params.client_path,
        product_path=product_path,
        filename_prefix=params.filename_prefix,
        runs_per_model=params.count,
        jobs=jobs,
        created_at=datetime.datetime.utcnow().isoformat() + "Z",
    )

    return {"batch_id": batch_id, "total": len(jobs), "queuing_errors": errors}


# ── Video Creation ────────────────────────────────────────────────────────────

class VideoCreationParams(BaseModel):
    first_frame: str          # 11_INPUT_IMAGE_LATENT - First Frame
    last_frame: str           # 12_INPUT_IMAGE_LATENT - Last Frame
    prompt: str               # 05_PROMPT_INSTRUCTION
    length: int = 121         # frame count (25–125)
    client_path: str
    product_path: str
    filename_prefix: str


@app.post("/api/workflow/video_creation")
async def run_video_creation(params: VideoCreationParams, x_user_token: Optional[str] = Header(None)):
    if not params.first_frame:
        raise HTTPException(422, "first_frame is required")
    if not params.last_frame:
        raise HTTPException(422, "last_frame is required")
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    if not MIN_LENGTH <= params.length <= MAX_LENGTH:
        raise HTTPException(422, f"length must be between {MIN_LENGTH} and {MAX_LENGTH}")

    for img_filename in [params.first_frame, params.last_frame]:
        _validate_image(img_filename)

    try:
        await _queue_cleanup()
        client_id = str(uuid.uuid4())
        workflow = load_video_creation(
            first_frame=params.first_frame,
            last_frame=params.last_frame,
            prompt=params.prompt,
            length=params.length,
            client_path=params.client_path,
            product_path=_dated_product_path(params.product_path, "Video_Creation"),
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        logger.info(f"[video_creation] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        logger.error(f"[video_creation] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Machine monitor ───────────────────────────────────────────────────────────

@app.get("/api/monitor/stats")
async def get_monitor_stats():
    stats_result, queue_result = await asyncio.gather(
        comfy_client.get_system_stats(),
        comfy_client.get_queue_detailed(),
        return_exceptions=True,
    )

    system, device = {}, {}
    if not isinstance(stats_result, Exception):
        system = stats_result.get("system", {})
        devices = stats_result.get("devices", [])
        device = devices[0] if devices else {}

    running_jobs, pending_jobs = [], []
    if not isinstance(queue_result, Exception):
        for item in queue_result.get("queue_running", []):
            extra = item[3] if len(item) > 3 else {}
            running_jobs.append({
                "prompt_id": item[1],
                "position": item[0],
                "client_id": extra.get("client_id", ""),
                "status": "running",
            })
        for item in queue_result.get("queue_pending", []):
            extra = item[3] if len(item) > 3 else {}
            pending_jobs.append({
                "prompt_id": item[1],
                "position": item[0],
                "client_id": extra.get("client_id", ""),
                "status": "pending",
            })

    def to_gb(b: int) -> float:
        return round(b / (1024 ** 3), 1)

    return {
        "ram_total_gb":  to_gb(system.get("ram_total", 0)),
        "ram_free_gb":   to_gb(system.get("ram_free",  0)),
        "vram_total_gb": to_gb(device.get("vram_total", 0)),
        "vram_free_gb":  to_gb(device.get("vram_free",  0)),
        "gpu_name":      device.get("name", ""),
        "queue_running": len(running_jobs),
        "queue_pending": len(pending_jobs),
        "jobs":          running_jobs + pending_jobs,
    }


# ── Manual RAM cleanup ────────────────────────────────────────────────────────

@app.post("/api/free")
async def free_memory():
    """Queue the RAM cleanup workflow manually (e.g. from a UI button)."""
    await _queue_cleanup()
    return {"status": "cleanup queued"}


# ── List available upscale rework models ──────────────────────────────────────

@app.get("/api/workflow/upscale_rework/models")
async def get_upscale_rework_models():
    return {"models": UPSCALE_REWORK_MODELS}


# ── Status / image proxy (shared) ─────────────────────────────────────────────

@app.get("/api/status/{prompt_id}")
async def get_status(prompt_id: str):
    history = await comfy_client.get_history(prompt_id)
    entry = history.get(prompt_id)
    if not entry:
        return {"status": "pending"}

    outputs = entry.get("outputs", {})
    images = []
    videos = []
    for node_output in outputs.values():
        for img in node_output.get("images", []):
            if img.get("type") == "output":  # exclude PreviewImage temp outputs
                images.append(img)
        # Video outputs are stored under "gifs" by ComfyUI video savers
        for vid in node_output.get("gifs", []):
            if vid.get("type") == "output":
                videos.append(vid)

    status = entry.get("status", {})
    completed = status.get("completed", False)
    error = status.get("status_str") == "error"

    if error:
        return {"status": "error"}
    if completed:
        return {"status": "done", "images": images, "videos": videos}
    return {"status": "processing"}


@app.get("/api/image")
async def proxy_image(filename: str, subfolder: str = "", type: str = "output"):
    data = await comfy_client.get_image(filename, subfolder, type)
    return Response(content=data, media_type="image/png")


@app.get("/api/video")
async def proxy_video(filename: str, subfolder: str = "", type: str = "output"):
    data = await comfy_client.get_image(filename, subfolder, type)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    media_type = {"mp4": "video/mp4", "webm": "video/webm", "gif": "image/gif"}.get(ext, "video/mp4")
    return Response(content=data, media_type=media_type)


# ---------------------------------------------------------------------------
# WebSocket — forward ComfyUI progress events
# ---------------------------------------------------------------------------

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await websocket.accept()
    try:
        msg = await websocket.receive_json()
        prompt_id = msg.get("prompt_id")
        if not prompt_id:
            await websocket.send_json({"type": "error", "message": "No prompt_id provided"})
            await websocket.close()
            return
        await comfy_client.watch_progress(client_id, prompt_id, websocket)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# ComfyUI direct-access URL
# ---------------------------------------------------------------------------

@app.get("/api/comfyui/url")
async def get_comfyui_url(request: Request):
    """Return the externally-accessible ComfyUI URL.

    ComfyUI runs on a fixed port inside the container. We derive the hostname
    from the incoming Host header so this works whether the caller is a browser
    on the LAN or the Electron app talking to localhost.
    """
    comfyui_host = os.getenv("COMFYUI_HOST", COMFYUI_HOST)
    port = comfyui_host.split(":")[1] if ":" in comfyui_host else "3001"
    hostname = request.headers.get("host", f"localhost:{port}").split(":")[0]
    return {"url": f"http://{hostname}:{port}"}


# ---------------------------------------------------------------------------
# Serve React static build (must be last)
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
