"""
Sync comparison and file transfer endpoints — called by the Electron desktop sync tool.
All endpoints require an admin user token (X-User-Token header).

Env vars:
  COMFYUI_OUTPUT_DIR  — path to ComfyUI output directory (default: /workspace/ComfyUI/output)
  COMFYUI_MODELS_DIR  — path to ComfyUI models directory (default: /workspace/ComfyUI/models)
  SYNC_MODELS_DIR     — override for models path used only by the sync tool (e.g. //nas/indgai/Models)
"""
import os
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, UploadFile, File
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
    root = Path(os.getenv("SYNC_MODELS_DIR") or os.getenv("COMFYUI_MODELS_DIR", "/workspace/ComfyUI/models"))
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


@router.get("/model-dirs")
def list_model_dirs(x_user_token: Optional[str] = Header(None)):
    """Subdirectory tree under the models root (2 levels deep) — used by the Model Uploader."""
    _require_admin(x_user_token)
    root = Path(os.getenv("SYNC_MODELS_DIR") or os.getenv("COMFYUI_MODELS_DIR", "/workspace/ComfyUI/models"))
    dirs: list = []
    if root.exists():
        for entry in sorted(root.iterdir()):
            if entry.is_dir():
                dirs.append(entry.name)
                for sub in sorted(entry.iterdir()):
                    if sub.is_dir():
                        dirs.append(f"{entry.name}/{sub.name}")
    return {"root": str(root), "dirs": dirs}


@router.post("/model-upload")
async def upload_model(
    path: str,
    file: UploadFile = File(...),
    x_user_token: Optional[str] = Header(None),
):
    """Stream a model file into the models directory at the given relative path."""
    _require_admin(x_user_token)
    root = Path(os.getenv("SYNC_MODELS_DIR") or os.getenv("COMFYUI_MODELS_DIR", "/workspace/ComfyUI/models"))
    full = _safe_path(root, path)
    full.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with open(full, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
            size += len(chunk)
    return {"ok": True, "path": path, "size": size}


@router.get("/db-export")
def db_export(x_user_token: Optional[str] = Header(None)):
    """Export full records from users.db + custom tools from tools.db for merge purposes."""
    _require_admin(x_user_token)
    from user_management import _get_conn
    from tools import _tools_db_path

    conn = _get_conn()
    try:
        result = {
            "groups":   [dict(r) for r in conn.execute("SELECT * FROM groups ORDER BY id").fetchall()],
            "clients":  [dict(r) for r in conn.execute("SELECT * FROM clients ORDER BY id").fetchall()],
            "projects": [dict(r) for r in conn.execute("SELECT * FROM projects ORDER BY id").fetchall()],
            "users":    [dict(r) for r in conn.execute("SELECT * FROM users ORDER BY id").fetchall()],
        }
    finally:
        conn.close()

    # Custom tools only — built-ins are seeded identically on every instance
    try:
        conn2 = sqlite3.connect(_tools_db_path())
        conn2.row_factory = sqlite3.Row
        try:
            result["tools"] = [
                dict(r) for r in
                conn2.execute("SELECT * FROM tools WHERE is_builtin=0 ORDER BY created_at").fetchall()
            ]
        finally:
            conn2.close()
    except Exception as e:
        result["tools"] = []
        result["tools_export_error"] = str(e)

    return result


@router.post("/db-import")
async def db_import(request: Request, x_user_token: Optional[str] = Header(None)):
    """Insert NAS records into this backend's users.db, skipping any that already exist."""
    _require_admin(x_user_token)
    payload = await request.json()

    from user_management import _get_conn
    from tools import _tools_db_path
    conn = _get_conn()
    counts = {"groups": 0, "clients": 0, "projects": 0, "users": 0, "tools": 0}
    try:
        # 1. Groups (unique on name)
        for g in payload.get("groups", []):
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO groups (name, can_access_admin, allowed_modules, created_at) VALUES (?,?,?,?)",
                    (g["name"], g.get("can_access_admin", 0), g.get("allowed_modules", "[]"), g.get("created_at")),
                )
                counts["groups"] += conn.execute("SELECT changes()").fetchone()[0]
            except Exception:
                pass
        conn.commit()

        # Build name→id map for group remapping
        group_name_to_id = {
            row["name"]: row["id"]
            for row in conn.execute("SELECT id, name FROM groups").fetchall()
        }
        source_groups = {g["id"]: g["name"] for g in payload.get("groups", [])}

        # 2. Clients (unique on client_id)
        for c in payload.get("clients", []):
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO clients (client_id, name, created_at) VALUES (?,?,?)",
                    (c["client_id"], c["name"], c.get("created_at")),
                )
                counts["clients"] += conn.execute("SELECT changes()").fetchone()[0]
            except Exception:
                pass
        conn.commit()

        # 3. Projects (unique on project_id)
        for p in payload.get("projects", []):
            try:
                conn.execute(
                    "INSERT OR IGNORE INTO projects (project_id, name, created_at) VALUES (?,?,?)",
                    (p["project_id"], p["name"], p.get("created_at")),
                )
                counts["projects"] += conn.execute("SELECT changes()").fetchone()[0]
            except Exception:
                pass
        conn.commit()

        # 4. Users (unique on username + email; remap group_id by group name)
        for u in payload.get("users", []):
            try:
                src_gid = u.get("group_id")
                target_gid = None
                if src_gid is not None:
                    gname = source_groups.get(src_gid)
                    if gname:
                        target_gid = group_name_to_id.get(gname)
                conn.execute(
                    "INSERT OR IGNORE INTO users "
                    "(username, email, password_hash, password_salt, is_admin, group_id, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (
                        u["username"], u.get("email", ""),
                        u["password_hash"], u["password_salt"],
                        u.get("is_admin", 0), target_gid,
                        u.get("created_at"), u.get("updated_at"),
                    ),
                )
                counts["users"] += conn.execute("SELECT changes()").fetchone()[0]
            except Exception:
                pass
        conn.commit()
    finally:
        conn.close()

    # Custom tools (tools.db) — INSERT OR IGNORE on id (UUID PK)
    try:
        conn2 = sqlite3.connect(_tools_db_path())
        conn2.row_factory = sqlite3.Row
        try:
            for t in payload.get("tools", []):
                if t.get("is_builtin"):
                    continue  # built-ins are seeded by the app on startup
                try:
                    conn2.execute(
                        "INSERT OR IGNORE INTO tools "
                        "(id, name, description, icon, is_builtin, fields_json, path_nodes, auto_nodes, workflow, created_at) "
                        "VALUES (?,?,?,?,0,?,?,?,?,?)",
                        (
                            t["id"], t["name"], t.get("description", ""),
                            t.get("icon", "Layers"),
                            t.get("fields_json", "[]"), t.get("path_nodes"),
                            t.get("auto_nodes", "[]"), t.get("workflow", "{}"),
                            t.get("created_at"),
                        ),
                    )
                    counts["tools"] += conn2.execute("SELECT changes()").fetchone()[0]
                except Exception:
                    pass
            conn2.commit()
        finally:
            conn2.close()
    except Exception as e:
        counts["tools_error"] = str(e)

    return {"ok": True, "inserted": counts}
