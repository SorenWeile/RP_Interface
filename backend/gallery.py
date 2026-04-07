"""
Gallery API routes — ported from comfyui-gallery Flask app.
Serves ComfyUI output images with folder browsing, thumbnails,
metadata extraction, favorites (SQLite), and ZIP downloads.
"""

import io
import json
import os
import sqlite3
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    print("WARNING: Pillow not installed — thumbnails and metadata extraction disabled.")

router = APIRouter(prefix="/api/gallery", tags=["gallery"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
THUMBNAIL_SIZE = (300, 300)
_THUMBNAIL_DIR = os.path.join(os.path.dirname(__file__), "gallery_thumbnails")
os.makedirs(_THUMBNAIL_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Database (SQLite, path relative to OUTPUT_DIR)
# ---------------------------------------------------------------------------

_DB_FILE: Optional[str] = None


def init_gallery_db() -> None:
    """Called once at app startup to create / migrate the SQLite schema."""
    global _DB_FILE
    output_dir = _output_dir()
    db_dir = os.path.join(output_dir, ".gallery_cache")
    os.makedirs(db_dir, exist_ok=True)
    _DB_FILE = os.path.join(db_dir, "gallery.db")

    with sqlite3.connect(_DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                mtime REAL NOT NULL,
                size INTEGER DEFAULT 0,
                type TEXT,
                dimensions TEXT,
                is_favorite INTEGER DEFAULT 0,
                last_synced REAL DEFAULT 0
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_fav ON files(is_favorite)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_path ON files(path)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mtime ON files(mtime DESC)")
        conn.commit()

    # Sync files from disk so favorites can be toggled immediately
    images = _get_images_recursive(output_dir)
    _sync_files_to_db(images)
    print(f"[gallery] DB ready at {_DB_FILE} ({len(images)} images synced)")


def _db() -> sqlite3.Connection:
    if not _DB_FILE:
        raise HTTPException(status_code=500, detail="Gallery DB not initialised")
    conn = sqlite3.connect(_DB_FILE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _file_id(path: str) -> str:
    return path.replace("\\", "/").replace("/", "_").replace(".", "_")


def _sync_files_to_db(images: list) -> None:
    if not _DB_FILE:
        return
    with sqlite3.connect(_DB_FILE) as conn:
        existing = {
            row[0]: row[1]
            for row in conn.execute("SELECT path, mtime FROM files").fetchall()
        }
        now = time.time()
        for img in images:
            p = img["path"]
            fid = _file_id(p)
            if p not in existing:
                conn.execute(
                    "INSERT OR IGNORE INTO files (id, path, name, mtime, size, type, last_synced)"
                    " VALUES (?, ?, ?, ?, ?, 'image', ?)",
                    (fid, p, img["name"], img["modified"], img.get("size", 0), now),
                )
            elif existing[p] != img["modified"]:
                conn.execute(
                    "UPDATE files SET name=?, mtime=?, size=?, last_synced=? WHERE id=?",
                    (img["name"], img["modified"], img.get("size", 0), now, fid),
                )
        # Remove DB entries for files no longer on disk
        on_disk = {img["path"] for img in images}
        stale = [p for p in existing if p not in on_disk]
        if stale:
            conn.execute(
                f"DELETE FROM files WHERE path IN ({','.join('?' * len(stale))})", stale
            )
        conn.commit()


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

def _output_dir() -> str:
    return os.environ.get("COMFYUI_OUTPUT_DIR", "/workspace/ComfyUI/output")


def _safe_path(rel_path: str) -> Optional[str]:
    """Resolve rel_path under OUTPUT_DIR, returning None if it escapes."""
    base = os.path.normpath(_output_dir())
    full = os.path.normpath(os.path.join(base, rel_path))
    return full if full.startswith(base) else None


def _encode_path(p: str) -> str:
    """Normalise path separators to forward-slash."""
    return p.replace("\\", "/")


# ---------------------------------------------------------------------------
# Image / folder scanning
# ---------------------------------------------------------------------------

def _get_images_recursive(directory: str) -> list:
    images = []
    if not os.path.exists(directory):
        return images
    for root, _dirs, files in os.walk(directory):
        for f in files:
            if Path(f).suffix.lower() in IMAGE_EXTENSIONS:
                full = os.path.join(root, f)
                rel = _encode_path(os.path.relpath(full, directory))
                stat = os.stat(full)
                images.append(
                    {
                        "path": rel,
                        "name": f,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "modified_str": datetime.fromtimestamp(stat.st_mtime).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                    }
                )
    images.sort(key=lambda x: x["modified"], reverse=True)
    return images


def _get_items_in_dir(directory: str, current_path: str = "") -> dict:
    items: dict = {"folders": [], "images": []}
    full = (
        os.path.normpath(os.path.join(directory, current_path))
        if current_path
        else directory
    )
    if not full.startswith(os.path.normpath(directory)) or not os.path.exists(full):
        return items
    try:
        for entry in os.listdir(full):
            ep = os.path.join(full, entry)
            rel = _encode_path(
                (current_path + "/" + entry).lstrip("/") if current_path else entry
            )
            if os.path.isdir(ep):
                stat = os.stat(ep)
                items["folders"].append(
                    {
                        "path": rel,
                        "name": entry,
                        "modified": stat.st_mtime,
                        "modified_str": datetime.fromtimestamp(stat.st_mtime).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                    }
                )
            elif os.path.isfile(ep) and Path(entry).suffix.lower() in IMAGE_EXTENSIONS:
                stat = os.stat(ep)
                items["images"].append(
                    {
                        "path": rel,
                        "name": entry,
                        "size": stat.st_size,
                        "modified": stat.st_mtime,
                        "modified_str": datetime.fromtimestamp(stat.st_mtime).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                    }
                )
    except Exception as e:
        print(f"[gallery] Error reading dir: {e}")
    items["folders"].sort(key=lambda x: x["name"].lower())
    items["images"].sort(key=lambda x: x["modified"], reverse=True)
    return items


# ---------------------------------------------------------------------------
# Directory tree (cached)
# ---------------------------------------------------------------------------

_tree_cache: Optional[list] = None
_tree_cache_time: Optional[float] = None
_CACHE_TTL = 300


def _build_tree(directory: str, current_path: str = "") -> list:
    tree = []
    full = (
        os.path.normpath(os.path.join(directory, current_path))
        if current_path
        else directory
    )
    if not full.startswith(os.path.normpath(directory)) or not os.path.exists(full):
        return tree
    try:
        folders = []
        for entry in os.listdir(full):
            ep = os.path.join(full, entry)
            if os.path.isdir(ep):
                rel = _encode_path(
                    (current_path + "/" + entry).lstrip("/") if current_path else entry
                )
                folders.append(
                    {
                        "name": entry,
                        "path": rel,
                        "type": "folder",
                        "children": _build_tree(directory, rel),
                    }
                )
        folders.sort(key=lambda x: x["name"].lower())
        tree.extend(folders)
    except Exception as e:
        print(f"[gallery] Tree error: {e}")
    return tree


def _get_cached_tree() -> list:
    global _tree_cache, _tree_cache_time
    now = time.time()
    if _tree_cache is not None and _tree_cache_time and (now - _tree_cache_time) < _CACHE_TTL:
        return _tree_cache
    _tree_cache = _build_tree(_output_dir())
    _tree_cache_time = now
    return _tree_cache


# ---------------------------------------------------------------------------
# Thumbnails
# ---------------------------------------------------------------------------

def _get_thumbnail_path(rel_path: str) -> Optional[str]:
    if not PIL_AVAILABLE:
        return None
    full = _safe_path(rel_path)
    if not full or not os.path.exists(full):
        return None
    thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(rel_path))}.jpg")
    img_mtime = os.path.getmtime(full)
    if os.path.exists(thumb) and os.path.getmtime(thumb) >= img_mtime:
        return thumb
    try:
        with Image.open(full) as img:
            if img.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                mask = img.split()[-1] if img.mode in ("RGBA", "LA") else None
                bg.paste(img, mask=mask)
                img = bg
            img.thumbnail(THUMBNAIL_SIZE, Image.Resampling.LANCZOS)
            img.save(thumb, "JPEG", quality=85, optimize=True)
        return thumb
    except Exception as e:
        print(f"[gallery] Thumbnail error for {rel_path}: {e}")
        return None


def _generate_thumbnails_bg(paths: list) -> None:
    for p in paths:
        try:
            _get_thumbnail_path(p)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Metadata / workflow parsing
# ---------------------------------------------------------------------------

def _parse_workflow_summary(workflow: dict) -> dict:
    summary: dict = {"nodes": []}
    if not workflow or not isinstance(workflow, dict):
        return summary
    try:
        if "nodes" in workflow and isinstance(workflow["nodes"], list):
            for node in workflow["nodes"]:
                if not isinstance(node, dict):
                    continue
                ntype = node.get("type", "Unknown")
                if ntype in ("Note", "NoteNode", "MarkdownNote", "PrimitiveNode"):
                    continue
                entry: dict = {
                    "id": node.get("id", "N/A"),
                    "type": ntype,
                    "title": node.get("title", ntype),
                    "params": {},
                }
                for i, v in enumerate(node.get("widgets_values", [])):
                    entry["params"][f"param_{i}"] = v
                summary["nodes"].append(entry)
        else:
            for node_id, node_data in workflow.items():
                if isinstance(node_data, dict) and "class_type" in node_data:
                    ntype = node_data.get("class_type", "Unknown")
                    entry = {"id": node_id, "type": ntype, "title": ntype, "params": {}}
                    for key, val in node_data.get("inputs", {}).items():
                        if isinstance(val, list) and len(val) == 2:
                            continue
                        entry["params"][key] = val
                    summary["nodes"].append(entry)
    except Exception as e:
        print(f"[gallery] Workflow parse error: {e}")
    return summary


def _get_image_metadata(file_path: str) -> dict:
    meta: dict = {
        "format": None,
        "size": {"width": 0, "height": 0},
        "mode": None,
        "file_size": 0,
        "prompt": None,
        "workflow": None,
        "workflow_summary": None,
        "parameters": {},
    }
    if not os.path.exists(file_path):
        return meta
    meta["file_size"] = os.path.getsize(file_path)
    if not PIL_AVAILABLE:
        return meta
    try:
        with Image.open(file_path) as img:
            meta["format"] = img.format
            meta["size"] = {"width": img.width, "height": img.height}
            meta["mode"] = img.mode
            if img.format == "PNG":
                info = img.info
                for key in ("prompt", "workflow"):
                    if key in info:
                        try:
                            s = (
                                info[key]
                                .replace("NaN", "null")
                                .replace("Infinity", "null")
                                .replace("-Infinity", "null")
                            )
                            meta[key] = json.loads(s)
                        except Exception:
                            meta[key] = info[key]
                if meta.get("prompt"):
                    meta["workflow_summary"] = _parse_workflow_summary(meta["prompt"])
                if not meta.get("workflow_summary") and meta.get("workflow"):
                    meta["workflow_summary"] = _parse_workflow_summary(meta["workflow"])
                for k, v in info.items():
                    if k not in ("prompt", "workflow"):
                        meta["parameters"][k] = v
    except Exception as e:
        meta["error"] = str(e)
    return meta


# ---------------------------------------------------------------------------
# Favorites DB helpers
# ---------------------------------------------------------------------------

def _fav_map(paths: List[str]) -> dict:
    if not _DB_FILE or not paths:
        return {}
    with sqlite3.connect(_DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        ph = ",".join("?" * len(paths))
        rows = conn.execute(
            f"SELECT path, is_favorite FROM files WHERE path IN ({ph})", paths
        ).fetchall()
    return {r["path"]: bool(r["is_favorite"]) for r in rows}


# ---------------------------------------------------------------------------
# Pydantic request models
# ---------------------------------------------------------------------------

class FavoriteBatchRequest(BaseModel):
    file_paths: List[str]
    is_favorite: bool


class DownloadMultipleRequest(BaseModel):
    paths: List[str]


class GenerateThumbnailsRequest(BaseModel):
    images: List[str]


class DeleteImagesRequest(BaseModel):
    paths: List[str]


class MoveRequest(BaseModel):
    source_path: str   # relative path of image to move
    dest_folder: str   # relative path of destination folder (empty = output root)


class RenameRequest(BaseModel):
    path: str       # relative path of image to rename
    new_name: str   # new filename (basename only, no directory)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/images")
def gallery_images():
    return _get_images_recursive(_output_dir())


@router.get("/browse")
@router.get("/browse/{folder_path:path}")
def gallery_browse(folder_path: str = ""):
    items = _get_items_in_dir(_output_dir(), folder_path)
    if items["images"]:
        fmap = _fav_map([i["path"] for i in items["images"]])
        for img in items["images"]:
            img["is_favorite"] = fmap.get(img["path"], False)
    return {"current_path": folder_path, "folders": items["folders"], "images": items["images"]}


@router.get("/tree")
def gallery_tree():
    return _get_cached_tree()


@router.get("/tree/refresh")
def gallery_tree_refresh():
    global _tree_cache, _tree_cache_time
    _tree_cache = None
    _tree_cache_time = None
    return {"status": "refreshed", "tree": _get_cached_tree()}


@router.get("/metadata/{image_path:path}")
def gallery_metadata(image_path: str):
    full = _safe_path(image_path)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Image not found")
    return _get_image_metadata(full)


@router.get("/image/{filename:path}")
def gallery_serve_image(filename: str):
    full = _safe_path(filename)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(full)


@router.get("/thumbnail/{filename:path}")
def gallery_serve_thumbnail(filename: str):
    thumb = _get_thumbnail_path(filename)
    if thumb and os.path.exists(thumb):
        return FileResponse(thumb, media_type="image/jpeg")
    full = _safe_path(filename)
    if full and os.path.exists(full):
        return FileResponse(full)
    raise HTTPException(status_code=404, detail="Not found")


@router.get("/download/{filename:path}")
def gallery_download(filename: str):
    full = _safe_path(filename)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(full, filename=os.path.basename(filename))


@router.get("/download-folder/{folder_path:path}")
def gallery_download_folder(folder_path: str):
    full = _safe_path(folder_path)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Folder not found")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(full):
            for f in files:
                fp = os.path.join(root, f)
                zf.write(fp, os.path.relpath(fp, full))
    buf.seek(0)
    name = os.path.basename(folder_path) or "output"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{name}.zip"'},
    )


@router.post("/download-multiple")
def gallery_download_multiple(req: DownloadMultipleRequest):
    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in req.paths:
            full = _safe_path(path.replace("\\", "/"))
            if full and os.path.exists(full):
                zf.write(full, os.path.basename(path))
                added += 1
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="images_{added}.zip"'},
    )


@router.post("/generate-thumbnails")
def gallery_gen_thumbnails(req: GenerateThumbnailsRequest):
    t = threading.Thread(target=_generate_thumbnails_bg, args=(req.images,), daemon=True)
    t.start()
    return {"status": "started", "total": len(req.images)}


@router.post("/favorite/{image_path:path}")
def gallery_toggle_favorite(image_path: str):
    if not _DB_FILE:
        raise HTTPException(status_code=500, detail="DB not initialised")
    fid = _file_id(image_path)
    with sqlite3.connect(_DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT is_favorite FROM files WHERE id=?", (fid,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="File not in DB — browse folder first")
        new_status = 1 - row["is_favorite"]
        conn.execute("UPDATE files SET is_favorite=? WHERE id=?", (new_status, fid))
        conn.commit()
    return {"status": "success", "is_favorite": bool(new_status), "path": image_path}


@router.post("/favorite-batch")
def gallery_favorite_batch(req: FavoriteBatchRequest):
    if not _DB_FILE:
        raise HTTPException(status_code=500, detail="DB not initialised")
    fids = [_file_id(p) for p in req.file_paths]
    with sqlite3.connect(_DB_FILE) as conn:
        ph = ",".join("?" * len(fids))
        cur = conn.execute(
            f"UPDATE files SET is_favorite=? WHERE id IN ({ph})",
            [1 if req.is_favorite else 0] + fids,
        )
        conn.commit()
    return {"status": "success", "updated": cur.rowcount, "is_favorite": req.is_favorite}


@router.get("/favorites")
def gallery_get_favorites():
    if not _DB_FILE:
        return {"images": [], "total": 0}
    with sqlite3.connect(_DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT path, name, mtime, size FROM files WHERE is_favorite=1 ORDER BY mtime DESC"
        ).fetchall()
    images = [
        {
            "path": r["path"],
            "name": r["name"],
            "modified": r["mtime"],
            "modified_str": datetime.fromtimestamp(r["mtime"]).strftime("%Y-%m-%d %H:%M:%S"),
            "size": r["size"],
            "is_favorite": True,
        }
        for r in rows
    ]
    return {"images": images, "total": len(images)}


@router.delete("/image/{image_path:path}")
def gallery_delete_image(image_path: str):
    full = _safe_path(image_path)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Image not found")
    if not os.path.isfile(full):
        raise HTTPException(status_code=400, detail="Path is not a file")
    # Remove thumbnail if it exists
    thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(image_path))}.jpg")
    if os.path.exists(thumb):
        os.remove(thumb)
    # Remove from DB
    if _DB_FILE:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.execute("DELETE FROM files WHERE path=?", (image_path,))
            conn.commit()
    os.remove(full)
    return {"status": "deleted", "path": image_path}


@router.delete("/folder/{folder_path:path}")
def gallery_delete_folder(folder_path: str):
    full = _safe_path(folder_path)
    if not full or not os.path.exists(full):
        raise HTTPException(status_code=404, detail="Folder not found")
    if not os.path.isdir(full):
        raise HTTPException(status_code=400, detail="Path is not a folder")
    # Collect all image paths under this folder before deleting
    images_in_folder = _get_images_recursive(full)
    rel_paths = []
    base = _output_dir()
    for img in images_in_folder:
        # img["path"] is relative to `full`, re-derive relative to base
        full_img = os.path.normpath(os.path.join(full, img["path"]))
        rel = _encode_path(os.path.relpath(full_img, base))
        rel_paths.append(rel)
        # Remove thumbnail
        thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(rel))}.jpg")
        if os.path.exists(thumb):
            os.remove(thumb)
    # Remove all DB entries
    if _DB_FILE and rel_paths:
        with sqlite3.connect(_DB_FILE) as conn:
            ph = ",".join("?" * len(rel_paths))
            conn.execute(f"DELETE FROM files WHERE path IN ({ph})", rel_paths)
            conn.commit()
    # Delete the folder tree
    import shutil
    shutil.rmtree(full)
    # Invalidate tree cache
    global _tree_cache, _tree_cache_time
    _tree_cache = None
    _tree_cache_time = None
    return {"status": "deleted", "path": folder_path, "images_removed": len(rel_paths)}


@router.post("/delete-images")
def gallery_delete_images(req: DeleteImagesRequest):
    """Batch delete multiple images."""
    deleted = []
    errors = []
    for image_path in req.paths:
        full = _safe_path(image_path)
        if not full or not os.path.exists(full) or not os.path.isfile(full):
            errors.append(image_path)
            continue
        thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(image_path))}.jpg")
        if os.path.exists(thumb):
            os.remove(thumb)
        if _DB_FILE:
            with sqlite3.connect(_DB_FILE) as conn:
                conn.execute("DELETE FROM files WHERE path=?", (image_path,))
                conn.commit()
        os.remove(full)
        deleted.append(image_path)
    return {"status": "done", "deleted": len(deleted), "errors": errors}


@router.post("/move")
def gallery_move(req: MoveRequest):
    import shutil
    src_path = req.source_path.replace("\\", "/")
    src_full = _safe_path(src_path)
    if not src_full or not os.path.exists(src_full) or not os.path.isfile(src_full):
        raise HTTPException(status_code=404, detail="Source image not found")

    dest_dir_full = (
        _safe_path(req.dest_folder.replace("\\", "/")) if req.dest_folder else _output_dir()
    )
    if not dest_dir_full or not os.path.isdir(dest_dir_full):
        raise HTTPException(status_code=404, detail="Destination folder not found")

    filename = os.path.basename(src_full)
    dest_full = os.path.join(dest_dir_full, filename)

    if os.path.exists(dest_full):
        raise HTTPException(
            status_code=409, detail=f"'{filename}' already exists in destination"
        )

    shutil.move(src_full, dest_full)

    new_rel = _encode_path(os.path.relpath(dest_full, _output_dir()))
    new_fid = _file_id(new_rel)
    old_fid = _file_id(src_path)

    if _DB_FILE:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.execute(
                "UPDATE files SET id=?, path=?, last_synced=? WHERE id=?",
                (new_fid, new_rel, time.time(), old_fid),
            )
            conn.commit()

    # Remove old thumbnail; new one will be generated on demand
    old_thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(src_path))}.jpg")
    if os.path.exists(old_thumb):
        os.remove(old_thumb)

    return {"status": "moved", "old_path": src_path, "new_path": new_rel}


@router.post("/rename")
def gallery_rename(req: RenameRequest):
    # Sanitise: new_name must be a bare filename with no path separators
    new_name = os.path.basename(req.new_name.strip())
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name must not be empty")
    if new_name != req.new_name.strip():
        raise HTTPException(status_code=400, detail="new_name must be a filename, not a path")

    src_path = req.path.replace("\\", "/")
    src_full = _safe_path(src_path)
    if not src_full or not os.path.exists(src_full) or not os.path.isfile(src_full):
        raise HTTPException(status_code=404, detail="Image not found")

    dest_full = os.path.join(os.path.dirname(src_full), new_name)
    if os.path.exists(dest_full):
        raise HTTPException(status_code=409, detail=f"'{new_name}' already exists in this folder")

    os.rename(src_full, dest_full)

    new_rel = _encode_path(os.path.relpath(dest_full, _output_dir()))
    new_fid = _file_id(new_rel)
    old_fid = _file_id(src_path)

    if _DB_FILE:
        with sqlite3.connect(_DB_FILE) as conn:
            conn.execute(
                "UPDATE files SET id=?, path=?, name=?, last_synced=? WHERE id=?",
                (new_fid, new_rel, new_name, time.time(), old_fid),
            )
            conn.commit()

    # Remove old thumbnail
    old_thumb = os.path.join(_THUMBNAIL_DIR, f"{abs(hash(src_path))}.jpg")
    if os.path.exists(old_thumb):
        os.remove(old_thumb)

    return {"status": "renamed", "old_path": src_path, "new_path": new_rel, "name": new_name}


@router.get("/health")
def gallery_health():
    return {"status": "healthy", "output_dir": _output_dir(), "db": _DB_FILE}
