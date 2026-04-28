"""
Sync comparison and file transfer endpoints — called by the Electron desktop sync tool.
All endpoints require an admin user token (X-User-Token header).

Env vars:
  COMFYUI_OUTPUT_DIR  — path to ComfyUI output directory (default: /workspace/ComfyUI/output)
  COMFYUI_MODELS_DIR  — path to ComfyUI models directory (default: /workspace/ComfyUI/models)
"""
import os
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/sync", tags=["sync"])


def _require_admin(token: Optional[str]) -> None:
    from user_management import _validate_user_token
    if not token:
        raise HTTPException(401, "Unauthorized")
    user_id = _validate_user_token(token)
    if user_id != 0:
        raise HTTPException(403, "Admin only")


def _walk_dir(root: Path) -> list:
    result = []
    if not root.exists():
        return result
    for entry in root.rglob("*"):
        if entry.is_file():
            try:
                stat = entry.stat()
                result.append({
                    "path": entry.relative_to(root).as_posix(),
                    "size": stat.st_size,
                    "mtime": int(stat.st_mtime),
                })
            except OSError:
                pass
    return result


@router.get("/files")
def list_output_files(x_user_token: Optional[str] = Header(None)):
    _require_admin(x_user_token)
    root = Path(os.getenv("COMFYUI_OUTPUT_DIR", "/workspace/ComfyUI/output"))
    return {"files": _walk_dir(root)}


@router.get("/models")
def list_models(x_user_token: Optional[str] = Header(None)):
    _require_admin(x_user_token)
    root = Path(os.getenv("COMFYUI_MODELS_DIR", "/workspace/ComfyUI/models"))
    return {"models": _walk_dir(root)}


@router.get("/db-summary")
def db_summary(x_user_token: Optional[str] = Header(None)):
    _require_admin(x_user_token)

    from user_management import _get_conn
    from tools import _tools_db_path

    result: dict = {}

    # users.db — users, groups, clients, projects
    try:
        conn = _get_conn()
        try:
            result["users"] = [
                dict(r) for r in
                conn.execute("SELECT id, username, created_at FROM users ORDER BY id").fetchall()
            ]
            result["groups"] = [
                dict(r) for r in
                conn.execute("SELECT id, name FROM groups ORDER BY id").fetchall()
            ]
            result["clients"] = [
                dict(r) for r in
                conn.execute("SELECT id, client_id, name FROM clients ORDER BY id").fetchall()
            ]
            result["projects"] = [
                dict(r) for r in
                conn.execute("SELECT id, project_id, name FROM projects ORDER BY id").fetchall()
            ]
        finally:
            conn.close()
    except Exception as e:
        result["users_error"] = str(e)

    # tools.db — custom + built-in tools
    try:
        conn2 = sqlite3.connect(_tools_db_path())
        conn2.row_factory = sqlite3.Row
        try:
            result["tools"] = [
                dict(r) for r in
                conn2.execute(
                    "SELECT id, name, description, is_builtin, created_at FROM tools ORDER BY id"
                ).fetchall()
            ]
        finally:
            conn2.close()
    except Exception as e:
        result["tools_error"] = str(e)

    return result


def _safe_path(root: Path, relative: str) -> Path:
    """Resolve relative path under root; raise 400 if it tries to escape."""
    full = (root / relative).resolve()
    if not str(full).startswith(str(root.resolve())):
        raise HTTPException(400, "Invalid path")
    return full


@router.get("/download")
def download_file(path: str, x_user_token: Optional[str] = Header(None)):
    _require_admin(x_user_token)
    root = Path(os.getenv("COMFYUI_OUTPUT_DIR", "/workspace/ComfyUI/output"))
    full = _safe_path(root, path)
    if not full.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(full, filename=full.name)


@router.post("/upload")
async def upload_file(
    path: str,
    file: UploadFile = File(...),
    x_user_token: Optional[str] = Header(None),
):
    _require_admin(x_user_token)
    root = Path(os.getenv("COMFYUI_OUTPUT_DIR", "/workspace/ComfyUI/output"))
    full = _safe_path(root, path)
    full.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with open(full, "wb") as f:
        while chunk := await file.read(1024 * 1024):  # 1 MB chunks
            f.write(chunk)
            size += len(chunk)
    return {"ok": True, "path": path, "size": size}
