"""
Tools DB — stores built-in and custom tools; generic workflow patcher;
FastAPI router for /api/tools.

Two SQLite tables share users.db:
  tools       — one row per tool (built-in or custom)
  batch_runs  — one row per run inside a tool batch job
"""

import copy
import datetime
import io
import json
import random
import uuid
import zipfile
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import comfy_client
import user_management as user_mgmt_module
from tools_seed import BUILTIN_TOOLS

router = APIRouter(prefix="/api/tools", tags=["tools"])

_MAX_SEED = 2**53 - 1


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_conn():
    import sqlite3
    conn = sqlite3.connect(user_mgmt_module._db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _create_tables() -> None:
    conn = _get_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tools (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT DEFAULT '',
                icon         TEXT DEFAULT 'Layers',
                is_builtin   INTEGER DEFAULT 0,
                fields_json  TEXT NOT NULL,
                path_nodes   TEXT,
                auto_nodes   TEXT DEFAULT '[]',
                workflow     TEXT NOT NULL,
                created_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS batch_runs (
                batch_id    TEXT NOT NULL,
                run_index   INTEGER NOT NULL,
                prompt_id   TEXT,
                client_id   TEXT,
                status      TEXT DEFAULT 'queued',
                output_json TEXT,
                PRIMARY KEY (batch_id, run_index)
            );
        """)
        conn.commit()
    finally:
        conn.close()


def _seed_builtin_tools() -> None:
    conn = _get_conn()
    try:
        for tool in BUILTIN_TOOLS:
            existing = conn.execute(
                "SELECT id FROM tools WHERE id = ?", (tool["id"],)
            ).fetchone()
            if existing:
                continue
            conn.execute(
                """
                INSERT INTO tools
                    (id, name, description, icon, is_builtin,
                     fields_json, path_nodes, auto_nodes, workflow, created_at)
                VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                """,
                (
                    tool["id"],
                    tool["name"],
                    tool.get("description", ""),
                    tool.get("icon", "Layers"),
                    tool["fields_json"],
                    tool.get("path_nodes"),
                    tool.get("auto_nodes", "[]"),
                    tool["workflow"],
                    datetime.datetime.utcnow().isoformat() + "Z",
                ),
            )
        conn.commit()
    finally:
        conn.close()


def init_tools_db() -> None:
    _create_tables()
    _seed_builtin_tools()


# ---------------------------------------------------------------------------
# CRUD helpers
# ---------------------------------------------------------------------------

def load_tool(tool_id: str) -> dict:
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM tools WHERE id = ?", (tool_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")
        return dict(row)
    finally:
        conn.close()


def list_tools(include_builtin: bool = True) -> list:
    conn = _get_conn()
    try:
        if include_builtin:
            rows = conn.execute(
                "SELECT id, name, description, icon, is_builtin, created_at FROM tools ORDER BY is_builtin DESC, created_at"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, description, icon, is_builtin, created_at FROM tools WHERE is_builtin = 0 ORDER BY created_at"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def save_tool(tool: dict) -> None:
    conn = _get_conn()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO tools
                (id, name, description, icon, is_builtin,
                 fields_json, path_nodes, auto_nodes, workflow, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tool["id"],
                tool["name"],
                tool.get("description", ""),
                tool.get("icon", "Layers"),
                tool.get("is_builtin", 0),
                tool["fields_json"],
                tool.get("path_nodes"),
                tool.get("auto_nodes", "[]"),
                tool["workflow"],
                tool.get("created_at", datetime.datetime.utcnow().isoformat() + "Z"),
            ),
        )
        conn.commit()
    finally:
        conn.close()


def delete_tool(tool_id: str) -> None:
    conn = _get_conn()
    try:
        row = conn.execute("SELECT is_builtin FROM tools WHERE id = ?", (tool_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Tool '{tool_id}' not found")
        if row["is_builtin"]:
            raise HTTPException(status_code=403, detail="Built-in tools cannot be deleted")
        conn.execute("DELETE FROM tools WHERE id = ?", (tool_id,))
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Generic patcher
# ---------------------------------------------------------------------------

def apply_patches(tool_row: dict, values: dict, username: str = "") -> dict:
    """
    Load the workflow from tool_row and apply all field patches + auto_nodes.
    Returns a ready-to-submit ComfyUI workflow dict.
    """
    workflow = copy.deepcopy(json.loads(tool_row["workflow"]))
    fields = json.loads(tool_row["fields_json"])
    auto = json.loads(tool_row.get("auto_nodes") or "[]")

    # Field patches
    for field in fields:
        value = values.get(field["id"], field.get("default"))
        if value is None:
            continue
        node = workflow.get(field["node_id"])
        if node:
            node["inputs"][field["input_key"]] = value

    # Path nodes (passed in via values with reserved keys __path_client etc.)
    path_nodes = json.loads(tool_row.get("path_nodes") or "null")
    if path_nodes:
        for key, node_id in path_nodes.items():
            v = values.get(f"__path_{key}")
            if v and node_id and node_id in workflow:
                workflow[node_id]["inputs"]["value"] = v

    # Auto-nodes
    for spec in auto:
        node = workflow.get(spec["node_id"])
        if not node:
            continue
        if spec["strategy"] == "random_seed":
            node["inputs"][spec["input_key"]] = random.randint(0, _MAX_SEED)
        elif spec["strategy"] == "username":
            node["inputs"][spec["input_key"]] = username

    return workflow


# ---------------------------------------------------------------------------
# Batch run helpers
# ---------------------------------------------------------------------------

def _create_batch(batch_id: str, total: int) -> None:
    conn = _get_conn()
    try:
        for i in range(total):
            conn.execute(
                "INSERT INTO batch_runs (batch_id, run_index, status) VALUES (?, ?, 'queued')",
                (batch_id, i),
            )
        conn.commit()
    finally:
        conn.close()


def _update_batch_run(batch_id: str, run_index: int, prompt_id: str, client_id: str, status: str) -> None:
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE batch_runs SET prompt_id=?, client_id=?, status=? WHERE batch_id=? AND run_index=?",
            (prompt_id, client_id, status, batch_id, run_index),
        )
        conn.commit()
    finally:
        conn.close()


def _get_batch_runs(batch_id: str) -> list:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM batch_runs WHERE batch_id = ? ORDER BY run_index",
            (batch_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _resolve_username(token: Optional[str]) -> str:
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
# Pydantic models
# ---------------------------------------------------------------------------

class RunToolBody(BaseModel):
    values: dict = {}
    path_client: str = ""
    path_product: str = ""
    path_filename: str = ""


class BatchRunBody(BaseModel):
    values: dict = {}
    count: int = 1
    path_client: str = ""
    path_product: str = ""
    path_filename: str = ""


class CreateToolBody(BaseModel):
    id: Optional[str] = None
    name: str
    description: str = ""
    icon: str = "Layers"
    fields_json: str
    path_nodes: Optional[str] = None
    auto_nodes: str = "[]"
    workflow: str


class UpdateToolBody(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    fields_json: Optional[str] = None
    path_nodes: Optional[str] = None
    auto_nodes: Optional[str] = None


# ---------------------------------------------------------------------------
# FastAPI router
# ---------------------------------------------------------------------------

@router.get("/")
async def api_list_tools():
    return list_tools(include_builtin=True)


@router.post("/")
async def api_create_tool(body: CreateToolBody):
    tool_id = body.id or str(uuid.uuid4())
    conn = _get_conn()
    try:
        existing = conn.execute("SELECT id FROM tools WHERE id = ?", (tool_id,)).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Tool id '{tool_id}' already exists")
    finally:
        conn.close()

    save_tool({
        "id": tool_id,
        "name": body.name,
        "description": body.description,
        "icon": body.icon,
        "is_builtin": 0,
        "fields_json": body.fields_json,
        "path_nodes": body.path_nodes,
        "auto_nodes": body.auto_nodes,
        "workflow": body.workflow,
    })
    return load_tool(tool_id)


@router.get("/batch/{batch_id}")
async def api_get_batch_status(batch_id: str):
    runs = _get_batch_runs(batch_id)
    if not runs:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        history = await comfy_client.get_all_history(max_items=500)
    except Exception:
        history = {}

    try:
        queue = await comfy_client.get_queue()
        running_ids: set = queue["running"]
    except Exception:
        running_ids = set()

    counts = {"queued": 0, "processing": 0, "done": 0, "error": 0}
    run_statuses = []

    for run in runs:
        pid = run.get("prompt_id")
        entry = history.get(pid) if pid else None
        if entry:
            s = entry.get("status", {})
            if s.get("status_str") == "error":
                status = "error"
            elif s.get("completed"):
                status = "done"
            else:
                status = "processing"
            images = []
            for node_output in entry.get("outputs", {}).values():
                images.extend(
                    img for img in node_output.get("images", [])
                    if img.get("type") == "output"
                )
        elif pid and pid in running_ids:
            status = "processing"
            images = []
        else:
            status = "queued"
            images = []

        counts[status] = counts.get(status, 0) + 1
        run_statuses.append({
            "run_index": run["run_index"],
            "prompt_id": pid,
            "status": status,
            "images": images,
        })

    return {
        "batch_id": batch_id,
        "total": len(runs),
        "queued": counts["queued"],
        "processing": counts["processing"],
        "done": counts["done"],
        "error": counts["error"],
        "runs": run_statuses,
    }


@router.get("/batch/{batch_id}/download")
async def api_download_batch(batch_id: str):
    runs = _get_batch_runs(batch_id)
    if not runs:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        history = await comfy_client.get_all_history(max_items=500)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach ComfyUI: {e}")

    image_refs = []
    for run in runs:
        pid = run.get("prompt_id")
        if not pid:
            continue
        entry = history.get(pid)
        if entry:
            for node_output in entry.get("outputs", {}).values():
                image_refs.extend(
                    img for img in node_output.get("images", [])
                    if img.get("type") == "output"
                )

    if not image_refs:
        raise HTTPException(status_code=404, detail="No completed images found")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
        for img in image_refs:
            try:
                data = await comfy_client.get_image(
                    img["filename"], img.get("subfolder", ""), img.get("type", "output")
                )
                if img["filename"].lower().endswith(".png"):
                    from gallery import _strip_png_metadata
                    data = _strip_png_metadata(data)
                zf.writestr(img["filename"], data)
            except Exception as e:
                print(f"[tools batch download] WARNING: could not fetch {img['filename']}: {e}")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{batch_id[:8]}.zip"'},
    )


@router.post("/batch/{batch_id}/cancel")
async def api_cancel_batch(batch_id: str):
    runs = _get_batch_runs(batch_id)
    if not runs:
        raise HTTPException(status_code=404, detail="Batch not found")

    try:
        queue = await comfy_client.get_queue()
        pending_ids: set = queue["pending"]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach ComfyUI: {e}")

    to_cancel = [r["prompt_id"] for r in runs if r.get("prompt_id") in pending_ids]
    await comfy_client.cancel_queue_items(to_cancel)
    return {"batch_id": batch_id, "cancelled": len(to_cancel)}


@router.get("/{tool_id}")
async def api_get_tool(tool_id: str):
    return load_tool(tool_id)


@router.put("/{tool_id}")
async def api_update_tool(tool_id: str, body: UpdateToolBody):
    row = load_tool(tool_id)
    if row["is_builtin"]:
        raise HTTPException(status_code=403, detail="Built-in tools cannot be edited via the API")

    if body.name is not None:
        row["name"] = body.name
    if body.description is not None:
        row["description"] = body.description
    if body.icon is not None:
        row["icon"] = body.icon
    if body.fields_json is not None:
        row["fields_json"] = body.fields_json
    if body.path_nodes is not None:
        row["path_nodes"] = body.path_nodes
    if body.auto_nodes is not None:
        row["auto_nodes"] = body.auto_nodes

    save_tool(row)
    return load_tool(tool_id)


@router.delete("/{tool_id}")
async def api_delete_tool(tool_id: str):
    delete_tool(tool_id)
    return {"deleted": tool_id}


@router.post("/{tool_id}/run")
async def api_run_tool(tool_id: str, body: RunToolBody, x_user_token: Optional[str] = Header(None)):
    tool = load_tool(tool_id)
    username = _resolve_username(x_user_token)

    values = dict(body.values)
    if body.path_client:
        values["__path_client"] = body.path_client
    if body.path_product:
        values["__path_product"] = body.path_product
    if body.path_filename:
        values["__path_filename"] = body.path_filename

    try:
        workflow = apply_patches(tool, values, username)
        client_id = str(uuid.uuid4())
        prompt_id = await comfy_client.queue_workflow(workflow, client_id)
        return {"prompt_id": prompt_id, "client_id": client_id}
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"{type(e).__name__}: {e}")


@router.post("/{tool_id}/batch")
async def api_run_tool_batch(
    tool_id: str, body: BatchRunBody, x_user_token: Optional[str] = Header(None)
):
    from config import MIN_BATCH_COUNT, MAX_BATCH_COUNT
    if not MIN_BATCH_COUNT <= body.count <= MAX_BATCH_COUNT:
        raise HTTPException(status_code=422, detail=f"count must be between {MIN_BATCH_COUNT} and {MAX_BATCH_COUNT}")

    tool = load_tool(tool_id)
    username = _resolve_username(x_user_token)

    batch_id = str(uuid.uuid4())
    _create_batch(batch_id, body.count)

    errors = []
    for i in range(body.count):
        try:
            values = dict(body.values)
            if body.path_client:
                values["__path_client"] = body.path_client
            if body.path_product:
                values["__path_product"] = body.path_product
            if body.path_filename:
                values["__path_filename"] = body.path_filename

            workflow = apply_patches(tool, values, username)
            client_id = str(uuid.uuid4())
            prompt_id = await comfy_client.queue_workflow(workflow, client_id)
            _update_batch_run(batch_id, i, prompt_id, client_id, "processing")
        except Exception as e:
            msg = f"run {i}: {type(e).__name__}: {e}"
            errors.append(msg)
            _update_batch_run(batch_id, i, "", "", "error")

    return {"batch_id": batch_id, "total": body.count, "queuing_errors": errors}
