import io
import os
import uuid
import zipfile
import datetime
import asyncio
import httpx
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect, Header
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import comfy_client
from workflows.loader import load_upscale, load_upscale_rework, load_outfit_swapping, load_panorama, load_image_edit
import gallery as gallery_module
import user_management as user_mgmt_module

app = FastAPI(title="ComfyUI Workflow UI")
app.include_router(gallery_module.router)
app.include_router(user_mgmt_module.router)
app.include_router(user_mgmt_module.auth_router)

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
    # ComfyUI reachability check
    host = os.getenv("COMFYUI_HOST", "127.0.0.1:3001")
    url = f"http://{host}"
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(url, timeout=3.0)
            if r.status_code < 500:
                print(f"[startup] ComfyUI reachable at {url}")
            else:
                print(f"[startup] WARNING: ComfyUI returned {r.status_code}")
    except Exception as e:
        print(f"[startup] WARNING: Could not reach ComfyUI at {url}: {e}")

    # Initialise gallery DB
    try:
        gallery_module.init_gallery_db()
    except Exception as e:
        print(f"[startup] WARNING: Gallery DB init failed: {e}")

    # Initialise user management DB
    try:
        user_mgmt_module.init_user_db()
    except Exception as e:
        print(f"[startup] WARNING: User DB init failed: {e}")



# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_username(token: Optional[str]) -> str:
    """Return the username for a user token, or 'admin'/'unknown' as fallback."""
    if not token:
        return "unknown"
    user_id = user_mgmt_module._validate_user_token(token)
    if user_id is None:
        return "unknown"
    if user_id == 0:
        return "admin"
    conn = user_mgmt_module._get_conn()
    try:
        row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        return row["username"] if row else "unknown"
    finally:
        conn.close()


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


# In-memory store — keyed by batch_id.
# Fine for a single-pod tool; no persistence needed across restarts.
_batches: dict = {}


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
# API routes
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    try:
        data = await file.read()
        assigned_name = await comfy_client.upload_image(data, file.filename or "upload.png")
        return {"filename": assigned_name}
    except Exception as e:
        print(f"[upload] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Simple upscale (original workflow) ────────────────────────────────────────

class WorkflowParams(BaseModel):
    filename: str


@app.post("/api/workflow/upscale")
async def run_upscale(params: WorkflowParams):
    try:
        client_id = str(uuid.uuid4())
        workflow = load_upscale(params.filename)
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        print(f"[upscale] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Upscale Rework — batch creation ───────────────────────────────────────────

UPSCALE_REWORK_MODELS = [
    "4xUltrasharp_4xUltrasharpV10.pt",
    "4xLexicaDAT2_otf.pth",
    "4xRealWebPhoto_v4.pth",
    "4xPurePhoto-RealPLSKR.pth",
    "4xRealWebPhoto_v3_atd.pth",
    "4xNomos8kSCHAT-L.pth",
]


class UpscaleReworkParams(BaseModel):
    filename: str
    models: List[str]           # subset of UPSCALE_REWORK_MODELS
    runs_per_model: int = 4
    client_path: str            # 95_CLIENT_PATH  e.g. "Deployed/HD"
    product_path: str           # 96_PRODUCT_PATH e.g. "ProjectName"
    filename_prefix: str        # 97_FILENAME     e.g. "Shot001"


@app.post("/api/workflow/upscale_rework")
async def run_upscale_rework(params: UpscaleReworkParams, x_user_token: Optional[str] = Header(None)):
    # Validate
    invalid = [m for m in params.models if m not in UPSCALE_REWORK_MODELS]
    if invalid:
        raise HTTPException(422, f"Unknown model(s): {invalid}")
    if not params.models:
        raise HTTPException(422, "Select at least one model")
    if not 1 <= params.runs_per_model <= 10:
        raise HTTPException(422, "runs_per_model must be between 1 and 10")

    username = _resolve_username(x_user_token)
    batch_id = str(uuid.uuid4())
    jobs: List[BatchJob] = []
    errors: List[str] = []

    for model in params.models:
        for run in range(1, params.runs_per_model + 1):
            try:
                client_id = str(uuid.uuid4())
                workflow = load_upscale_rework(
                    filename=params.filename,
                    model_name=model,
                    run_index=run,
                    client_path=params.client_path,
                    product_path=params.product_path,
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
                print(f"[batch:{batch_id}] queued {model} run {run} → {prompt_id}")
            except Exception as e:
                msg = f"{model} run {run}: {type(e).__name__}: {e}"
                print(f"[batch:{batch_id}] ERROR queuing {msg}")
                errors.append(msg)

    if not jobs:
        raise HTTPException(422, f"All jobs failed to queue: {errors}")

    _batches[batch_id] = Batch(
        id=batch_id,
        filename=params.filename,
        client_path=params.client_path,
        product_path=params.product_path,
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
        history = await comfy_client.get_all_history(max_items=500)
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

    print(f"[batch:{batch_id}] cancelled {len(to_cancel)} pending job(s)")
    return {"batch_id": batch_id, "cancelled": len(to_cancel)}


# ── Batch download ─────────────────────────────────────────────────────────────

@app.get("/api/batch/{batch_id}/download")
async def download_batch_zip(batch_id: str):
    from fastapi.responses import StreamingResponse
    batch = _batches.get(batch_id)
    if not batch:
        raise HTTPException(404, "Batch not found")

    try:
        history = await comfy_client.get_all_history(max_items=500)
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
                    from backend.gallery import _strip_png_metadata
                    data = _strip_png_metadata(data)
                zf.writestr(img["filename"], data)
            except Exception as e:
                print(f"[download:{batch_id}] WARNING: could not fetch {img['filename']}: {e}")

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
    ref_images: List[str]     # up to 7 reference image filenames
    prompt: str               # 05_PROMPT_POSITIVE_INSTRUCTION
    client_path: str          # 95_CLIENT_PATH
    product_path: str         # 96_PRODUCT_PATH
    filename_prefix: str      # 97_FILENAME


@app.post("/api/workflow/outfit_swapping")
async def run_outfit_swapping(params: OutfitSwappingParams, x_user_token: Optional[str] = Header(None)):
    if not params.main_image:
        raise HTTPException(422, "main_image is required")
    if len(params.ref_images) > 7:
        raise HTTPException(422, "At most 7 reference images are supported")
    
    # Validate all image filenames
    all_images = [params.main_image] + params.ref_images
    for img_filename in all_images:
        if not img_filename or not isinstance(img_filename, str):
            raise HTTPException(422, f"Invalid image filename: {img_filename}")
        if not img_filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            raise HTTPException(422, f"Unsupported image format: {img_filename}")
    
    try:
        client_id = str(uuid.uuid4())
        workflow = load_outfit_swapping(
            main_image=params.main_image,
            ref_images=params.ref_images,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=params.product_path,
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        print(f"[outfit_swapping] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        error_msg = str(e)
        print(f"[outfit_swapping] ERROR: {type(e).__name__}: {e}")
        
        # Provide more specific error messages for common issues
        if "Invalid image file" in error_msg:
            # Extract filenames from the error message
            import re
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
    prompt: str = "Fill the green spaces according to the image. Outpaint as a seamless 360 equirectangular panorama (2:1). Keep the horizon level. Match left and right edges."
    client_path: str = "HD"          # 95_CLIENT_PATH
    product_path: str = "Panorama"   # 96_PRODUCT_PATH
    filename_prefix: str = "Shot001" # 97_FILENAME


@app.post("/api/workflow/panorama")
async def run_panorama(params: PanoramaParams, x_user_token: Optional[str] = Header(None)):
    if not params.state_json:
        raise HTTPException(422, "state_json is required")
    try:
        client_id = str(uuid.uuid4())
        workflow = load_panorama(
            state_json=params.state_json,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=params.product_path,
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        print(f"[panorama] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        print(f"[panorama] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Image Edit ────────────────────────────────────────────────────────────────

class ImageEditParams(BaseModel):
    filename: str             # 11_INPUT_IMAGE_LATENT
    prompt: str               # 05_PROMPT_INSTRUCTION
    client_path: str          # 95_CLIENT_PATH
    product_path: str         # 96_PRODUCT_PATH
    filename_prefix: str      # 97_FILENAME


@app.post("/api/workflow/image_edit")
async def run_image_edit(params: ImageEditParams, x_user_token: Optional[str] = Header(None)):
    if not params.filename:
        raise HTTPException(422, "filename is required")
    if not params.prompt:
        raise HTTPException(422, "prompt is required")
    try:
        client_id = str(uuid.uuid4())
        workflow = load_image_edit(
            filename=params.filename,
            prompt=params.prompt,
            client_path=params.client_path,
            product_path=params.product_path,
            filename_prefix=params.filename_prefix,
            username=_resolve_username(x_user_token),
        )
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        print(f"[image_edit] queued → {prompt_id}")
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        print(f"[image_edit] ERROR: {type(e).__name__}: {e}")
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


# ── Image Edit — batch ────────────────────────────────────────────────────────

class ImageEditBatchParams(BaseModel):
    filename: str
    prompt: str
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
    if not 1 <= params.count <= 10:
        raise HTTPException(422, "count must be between 1 and 10")

    username = _resolve_username(x_user_token)
    batch_id = str(uuid.uuid4())
    jobs: List[BatchJob] = []
    errors: List[str] = []

    for run in range(1, params.count + 1):
        try:
            client_id = str(uuid.uuid4())
            # Append run suffix only when count > 1 to keep single-run paths clean
            prefix = f"{params.filename_prefix}_r{run:02d}_" if params.count > 1 else params.filename_prefix
            workflow = load_image_edit(
                filename=params.filename,
                prompt=params.prompt,
                client_path=params.client_path,
                product_path=params.product_path,
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
            print(f"[image_edit_batch:{batch_id}] queued run {run} → {prompt_id}")
        except Exception as e:
            msg = f"run {run}: {type(e).__name__}: {e}"
            print(f"[image_edit_batch:{batch_id}] ERROR: {msg}")
            errors.append(msg)

    if not jobs:
        raise HTTPException(422, f"All jobs failed to queue: {errors}")

    _batches[batch_id] = Batch(
        id=batch_id,
        filename=params.filename,
        client_path=params.client_path,
        product_path=params.product_path,
        filename_prefix=params.filename_prefix,
        runs_per_model=params.count,
        jobs=jobs,
        created_at=datetime.datetime.utcnow().isoformat() + "Z",
    )

    return {"batch_id": batch_id, "total": len(jobs), "queuing_errors": errors}


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
    for node_output in outputs.values():
        for img in node_output.get("images", []):
            if img.get("type") == "output":  # exclude PreviewImage temp outputs
                images.append(img)

    status = entry.get("status", {})
    completed = status.get("completed", False)
    error = status.get("status_str") == "error"

    if error:
        return {"status": "error"}
    if completed:
        return {"status": "done", "images": images}
    return {"status": "processing"}


@app.get("/api/image")
async def proxy_image(filename: str, subfolder: str = "", type: str = "output"):
    from fastapi.responses import Response
    data = await comfy_client.get_image(filename, subfolder, type)
    return Response(content=data, media_type="image/png")


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
# Serve React static build (must be last)
# ---------------------------------------------------------------------------

STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
