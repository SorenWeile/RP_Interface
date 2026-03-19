import os
import uuid
import asyncio
import httpx
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

import comfy_client
from workflows.loader import load_upscale

app = FastAPI(title="ComfyUI Workflow UI")

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
async def check_comfyui():
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


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    assigned_name = await comfy_client.upload_image(data, file.filename or "upload.png")
    return {"filename": assigned_name}


class WorkflowParams(BaseModel):
    filename: str
    scale_by: Optional[float] = 2.0


@app.post("/api/workflow/upscale")
async def run_upscale(params: WorkflowParams):
    client_id = str(uuid.uuid4())
    workflow = load_upscale(params.filename, params.scale_by or 2.0)
    prompt_id = await comfy_client.queue_workflow(workflow, client_id)
    return {"prompt_id": prompt_id, "client_id": client_id}


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
    # Wait for the frontend to send the prompt_id
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
