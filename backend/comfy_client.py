"""
ComfyUI HTTP + WebSocket client.
Fully decoupled from FastAPI — testable standalone.
"""

import os
import asyncio
import httpx
import websockets
import json
from typing import Any

COMFYUI_HOST = os.getenv("COMFYUI_HOST", "127.0.0.1:3001")
COMFYUI_HTTP = f"http://{COMFYUI_HOST}"
COMFYUI_WS   = f"ws://{COMFYUI_HOST}"


async def upload_image(image_bytes: bytes, filename: str) -> str:
    """POST image to ComfyUI /upload/image. Returns the filename ComfyUI assigned."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{COMFYUI_HTTP}/upload/image",
            files={"image": (filename, image_bytes, "image/png")},
            data={"overwrite": "true"},
        )
        response.raise_for_status()
        data = response.json()
        return data["name"]


async def queue_workflow(workflow: dict, client_id: str) -> str:
    """POST workflow to ComfyUI /prompt. Returns prompt_id."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{COMFYUI_HTTP}/prompt",
            json={"prompt": workflow, "client_id": client_id},
        )
        response.raise_for_status()
        data = response.json()
        # ComfyUI returns 200 even for validation errors — surface them explicitly
        if "error" in data:
            error = data["error"]
            msg = error.get("message", str(error))
            node_errors = data.get("node_errors", {})
            if node_errors:
                msg += f" | node errors: {node_errors}"
            raise RuntimeError(msg)
        return data["prompt_id"]


async def get_history(prompt_id: str) -> dict:
    """GET ComfyUI /history/{prompt_id}. Returns output info including generated filenames."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{COMFYUI_HTTP}/history/{prompt_id}")
        response.raise_for_status()
        return response.json()


async def get_image(filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
    """GET image bytes from ComfyUI /view."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{COMFYUI_HTTP}/view",
            params={"filename": filename, "subfolder": subfolder, "type": folder_type},
        )
        response.raise_for_status()
        return response.content


async def watch_progress(client_id: str, prompt_id: str, websocket: Any) -> None:
    """
    Connect to ComfyUI WebSocket and forward progress events to the caller's WebSocket.
    Stops when execution completes or errors.
    """
    uri = f"{COMFYUI_WS}/ws?clientId={client_id}"
    try:
        async with websockets.connect(uri) as ws:
            async for raw in ws:
                try:
                    msg = json.loads(raw)
                except (json.JSONDecodeError, TypeError):
                    continue

                msg_type = msg.get("type")

                if msg_type == "progress":
                    data = msg.get("data", {})
                    await websocket.send_json({
                        "type": "progress",
                        "value": data.get("value", 0),
                        "max": data.get("max", 1),
                    })

                elif msg_type == "executing":
                    data = msg.get("data", {})
                    if data.get("prompt_id") == prompt_id and data.get("node") is None:
                        # Execution complete
                        await websocket.send_json({"type": "complete", "prompt_id": prompt_id})
                        return

                elif msg_type in ("execution_error", "execution_interrupted"):
                    await websocket.send_json({"type": "error", "data": msg.get("data", {})})
                    return

    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
