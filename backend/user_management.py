"""
User management + auth API.

Env vars:
  ADMIN_PASSWORD   (required) — admin login password; also allows logging in
                                 as username "admin" at the app level
  ADMIN_SECRET_KEY (optional) — HMAC signing key; random key used if unset
                                 (sessions invalidated on restart without this)
  WORKSPACE_DIR    (optional) — defaults to /workspace

DB: $WORKSPACE_DIR/.rp_interface/users.db

Routers:
  router      — /api/admin/...  (admin-only CRUD)
  auth_router — /api/auth/...   (app-level login/logout/me)
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])
auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _db_dir() -> Path:
    workspace = os.environ.get("WORKSPACE_DIR", "/workspace")
    db_dir = Path(workspace) / ".rp_interface"
    try:
        db_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        db_dir = Path(".rp_interface")
        db_dir.mkdir(exist_ok=True)
    return db_dir


def _db_path() -> str:
    return str(_db_dir() / "users.db")


def _admin_password() -> str:
    return os.environ.get("ADMIN_PASSWORD", "admin")


_SECRET_KEY: str = os.environ.get("ADMIN_SECRET_KEY") or secrets.token_hex(32)

_sessions: dict = {}       # admin panel sessions
_user_sessions: dict = {}  # app-level user sessions
SESSION_TTL = 8 * 3600     # 8 hours

# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_user_db() -> None:
    conn = _get_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS groups (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                name             TEXT UNIQUE NOT NULL,
                can_access_admin INTEGER NOT NULL DEFAULT 0,
                allowed_modules  TEXT NOT NULL DEFAULT '[]',
                created_at       TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                email         TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                is_admin      INTEGER NOT NULL DEFAULT 0,
                group_id      INTEGER REFERENCES groups(id) ON DELETE SET NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS clients (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id  TEXT UNIQUE NOT NULL,
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS projects (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id TEXT UNIQUE NOT NULL,
                name       TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS user_clients (
                user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
                client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, client_id)
            );
            CREATE TABLE IF NOT EXISTS user_projects (
                user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                PRIMARY KEY (user_id, project_id)
            );
        """)
        conn.commit()

        # Migration: add group_id to users if the column was added after initial creation
        try:
            conn.execute("ALTER TABLE users ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists

        # Migration: add client_id to projects
        try:
            conn.execute("ALTER TABLE projects ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL")
            conn.commit()
        except sqlite3.OperationalError:
            pass  # column already exists

        print(f"[user_db] Initialized at {_db_path()}")
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

def _hash_password(password: str, salt: str) -> str:
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return dk.hex()


def _verify_password(password: str, salt: str, stored_hash: str) -> bool:
    return hmac.compare_digest(_hash_password(password, salt), stored_hash)

# ---------------------------------------------------------------------------
# Session tokens
# ---------------------------------------------------------------------------

def _make_token(store: dict, user_id: int) -> str:
    raw = secrets.token_hex(32)
    sig = hmac.new(_SECRET_KEY.encode(), raw.encode(), "sha256").hexdigest()
    token = f"{raw}.{sig}"
    store[token] = {"user_id": user_id, "expires": time.time() + SESSION_TTL}
    return token


def _check_token(store: dict, token: str) -> Optional[int]:
    if not token or "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    expected = hmac.new(_SECRET_KEY.encode(), raw.encode(), "sha256").hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    session = store.get(token)
    if not session or time.time() > session["expires"]:
        store.pop(token, None)
        return None
    return session["user_id"]


def _create_token(user_id: int) -> str:
    return _make_token(_sessions, user_id)

def _validate_token(token: str) -> Optional[int]:
    return _check_token(_sessions, token)

def _create_user_token(user_id: int) -> str:
    return _make_token(_user_sessions, user_id)

def _validate_user_token(token: str) -> Optional[int]:
    return _check_token(_user_sessions, token)


async def require_token(x_admin_token: Optional[str] = Header(None)) -> int:
    user_id = _validate_token(x_admin_token or "")
    if user_id is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user_id

# ---------------------------------------------------------------------------
# Row helpers
# ---------------------------------------------------------------------------

# All module IDs the app knows about — used as full-access set for admin user
ALL_MODULE_IDS = ["gallery", "upscaler", "upscaler-rework", "outfit-swapping", "panorama"]

_ADMIN_USER = {
    "id": 0,
    "username": "admin",
    "email": "",
    "is_admin": True,
    "group": {
        "id": -1,
        "name": "admin",
        "can_access_admin": True,
        "allowed_modules": ALL_MODULE_IDS,
    },
    "clients": [],
    "projects": [],
}


def _group_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "can_access_admin": bool(row["can_access_admin"]),
        "allowed_modules": json.loads(row["allowed_modules"] or "[]"),
        "created_at": row["created_at"],
    }


def _user_row(row: sqlite3.Row, conn: sqlite3.Connection) -> dict:
    uid = row["id"]
    clients = conn.execute(
        "SELECT c.id, c.client_id, c.name FROM user_clients uc "
        "JOIN clients c ON c.id = uc.client_id WHERE uc.user_id = ?",
        (uid,),
    ).fetchall()
    projects = conn.execute(
        "SELECT p.id, p.project_id, p.name FROM user_projects up "
        "JOIN projects p ON p.id = up.project_id WHERE up.user_id = ?",
        (uid,),
    ).fetchall()
    group = None
    gid = row["group_id"] if "group_id" in row.keys() else None
    if gid:
        g = conn.execute("SELECT * FROM groups WHERE id=?", (gid,)).fetchone()
        if g:
            group = _group_dict(g)
    return {
        "id": uid,
        "username": row["username"],
        "email": row["email"],
        "is_admin": bool(row["is_admin"]),
        "group": group,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "clients": [dict(c) for c in clients],
        "projects": [dict(p) for p in projects],
    }

# ---------------------------------------------------------------------------
# Admin panel auth  (/api/admin/login …)
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(req: LoginRequest):
    if not hmac.compare_digest(req.password, _admin_password()):
        raise HTTPException(401, "Invalid password")
    token = _create_token(0)
    return {"token": token, "expires_in": SESSION_TTL}


@router.post("/logout")
def logout(x_admin_token: Optional[str] = Header(None)):
    _sessions.pop(x_admin_token or "", None)
    return {"ok": True}


@router.get("/me")
def get_me(_: int = Depends(require_token)):
    return {"authenticated": True}

# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------

class GroupRequest(BaseModel):
    name: str
    can_access_admin: bool = False
    allowed_modules: list = []


@router.get("/groups")
def list_groups(_: int = Depends(require_token)):
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT * FROM groups ORDER BY name").fetchall()
        return [_group_dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/groups", status_code=201)
def create_group(req: GroupRequest, _: int = Depends(require_token)):
    if not req.name.strip():
        raise HTTPException(422, "Group name is required")
    conn = _get_conn()
    try:
        try:
            cur = conn.execute(
                "INSERT INTO groups (name, can_access_admin, allowed_modules) VALUES (?,?,?)",
                (req.name.strip(), int(req.can_access_admin), json.dumps(req.allowed_modules)),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM groups WHERE id=?", (cur.lastrowid,)).fetchone()
            return _group_dict(row)
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"Conflict: {e}")
    finally:
        conn.close()


@router.put("/groups/{group_id}")
def update_group(group_id: int, req: GroupRequest, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE groups SET name=?, can_access_admin=?, allowed_modules=? WHERE id=?",
            (req.name.strip(), int(req.can_access_admin), json.dumps(req.allowed_modules), group_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM groups WHERE id=?", (group_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Group not found")
        return _group_dict(row)
    finally:
        conn.close()


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM groups WHERE id=?", (group_id,))
        conn.commit()
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

class CreateUserRequest(BaseModel):
    username: str
    email: str
    password: str
    group_id: Optional[int] = None
    client_ids: list = []
    project_ids: list = []


class UpdateUserRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    group_id: Optional[int] = None
    client_ids: Optional[list] = None
    project_ids: Optional[list] = None


@router.get("/users")
def list_users(_: int = Depends(require_token)):
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT * FROM users ORDER BY username").fetchall()
        return [_user_row(r, conn) for r in rows]
    finally:
        conn.close()


@router.post("/users", status_code=201)
def create_user(req: CreateUserRequest, _: int = Depends(require_token)):
    if not req.username.strip():
        raise HTTPException(422, "Username is required")
    if not req.email.strip():
        raise HTTPException(422, "Email is required")
    if not req.password:
        raise HTTPException(422, "Password is required")
    salt = secrets.token_hex(16)
    pw_hash = _hash_password(req.password, salt)
    conn = _get_conn()
    try:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, email, password_hash, password_salt, group_id) VALUES (?,?,?,?,?)",
                (req.username.strip(), req.email.strip(), pw_hash, salt, req.group_id),
            )
            uid = cur.lastrowid
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"Conflict: {e}")
        for cid in req.client_ids:
            conn.execute("INSERT OR IGNORE INTO user_clients VALUES (?,?)", (uid, cid))
        for pid in req.project_ids:
            conn.execute("INSERT OR IGNORE INTO user_projects VALUES (?,?)", (uid, pid))
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        return _user_row(row, conn)
    finally:
        conn.close()


@router.put("/users/{user_id}")
def update_user(user_id: int, req: UpdateUserRequest, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        if req.username is not None:
            conn.execute(
                "UPDATE users SET username=?, updated_at=datetime('now') WHERE id=?",
                (req.username.strip(), user_id),
            )
        if req.email is not None:
            conn.execute(
                "UPDATE users SET email=?, updated_at=datetime('now') WHERE id=?",
                (req.email.strip(), user_id),
            )
        if req.password:
            salt = secrets.token_hex(16)
            pw_hash = _hash_password(req.password, salt)
            conn.execute(
                "UPDATE users SET password_hash=?, password_salt=?, updated_at=datetime('now') WHERE id=?",
                (pw_hash, salt, user_id),
            )
        if req.group_id is not None or "group_id" in req.model_fields_set:
            conn.execute(
                "UPDATE users SET group_id=?, updated_at=datetime('now') WHERE id=?",
                (req.group_id, user_id),
            )
        if req.client_ids is not None:
            conn.execute("DELETE FROM user_clients WHERE user_id=?", (user_id,))
            for cid in req.client_ids:
                conn.execute("INSERT OR IGNORE INTO user_clients VALUES (?,?)", (user_id, cid))
        if req.project_ids is not None:
            conn.execute("DELETE FROM user_projects WHERE user_id=?", (user_id,))
            for pid in req.project_ids:
                conn.execute("INSERT OR IGNORE INTO user_projects VALUES (?,?)", (user_id, pid))
        conn.commit()
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        return _user_row(row, conn)
    finally:
        conn.close()


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

class ClientRequest(BaseModel):
    client_id: str
    name: str


@router.get("/clients")
def list_clients(_: int = Depends(require_token)):
    conn = _get_conn()
    try:
        rows = conn.execute("SELECT * FROM clients ORDER BY name").fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("/clients", status_code=201)
def create_client(req: ClientRequest, _: int = Depends(require_token)):
    if not req.client_id.strip():
        raise HTTPException(422, "client_id is required")
    conn = _get_conn()
    try:
        try:
            cur = conn.execute(
                "INSERT INTO clients (client_id, name) VALUES (?,?)",
                (req.client_id.strip(), req.name.strip()),
            )
            conn.commit()
            return dict(conn.execute("SELECT * FROM clients WHERE id=?", (cur.lastrowid,)).fetchone())
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"Conflict: {e}")
    finally:
        conn.close()


@router.put("/clients/{client_db_id}")
def update_client(client_db_id: int, req: ClientRequest, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE clients SET client_id=?, name=? WHERE id=?",
            (req.client_id.strip(), req.name.strip(), client_db_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM clients WHERE id=?", (client_db_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Client not found")
        return dict(row)
    finally:
        conn.close()


@router.delete("/clients/{client_db_id}", status_code=204)
def delete_client(client_db_id: int, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM clients WHERE id=?", (client_db_id,))
        conn.commit()
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class ProjectRequest(BaseModel):
    project_id: str
    name: str
    client_id: Optional[int] = None


def _project_dict(project_db_id: int, conn: sqlite3.Connection) -> dict:
    row = conn.execute(
        "SELECT p.id, p.project_id, p.name, p.client_id, p.created_at, "
        "c.client_id as client_ext_id, c.name as client_name "
        "FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id=?",
        (project_db_id,),
    ).fetchone()
    if not row:
        return {}
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "name": row["name"],
        "client_id": row["client_id"],
        "client": {"id": row["client_id"], "client_id": row["client_ext_id"], "name": row["client_name"]}
                  if row["client_id"] else None,
        "created_at": row["created_at"],
    }


@router.get("/projects")
def list_projects(_: int = Depends(require_token)):
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT p.id, p.project_id, p.name, p.client_id, p.created_at, "
            "c.client_id as client_ext_id, c.name as client_name "
            "FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.name"
        ).fetchall()
        result = []
        for row in rows:
            result.append({
                "id": row["id"],
                "project_id": row["project_id"],
                "name": row["name"],
                "client_id": row["client_id"],
                "client": {"id": row["client_id"], "client_id": row["client_ext_id"], "name": row["client_name"]}
                          if row["client_id"] else None,
                "created_at": row["created_at"],
            })
        return result
    finally:
        conn.close()


@router.post("/projects", status_code=201)
def create_project(req: ProjectRequest, _: int = Depends(require_token)):
    if not req.project_id.strip():
        raise HTTPException(422, "project_id is required")
    conn = _get_conn()
    try:
        try:
            cur = conn.execute(
                "INSERT INTO projects (project_id, name, client_id) VALUES (?,?,?)",
                (req.project_id.strip(), req.name.strip(), req.client_id),
            )
            conn.commit()
            return _project_dict(cur.lastrowid, conn)
        except sqlite3.IntegrityError as e:
            raise HTTPException(409, f"Conflict: {e}")
    finally:
        conn.close()


@router.put("/projects/{project_db_id}")
def update_project(project_db_id: int, req: ProjectRequest, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute(
            "UPDATE projects SET project_id=?, name=?, client_id=? WHERE id=?",
            (req.project_id.strip(), req.name.strip(), req.client_id, project_db_id),
        )
        conn.commit()
        result = _project_dict(project_db_id, conn)
        if not result:
            raise HTTPException(404, "Project not found")
        return result
    finally:
        conn.close()


@router.delete("/projects/{project_db_id}", status_code=204)
def delete_project(project_db_id: int, _: int = Depends(require_token)):
    conn = _get_conn()
    try:
        conn.execute("DELETE FROM projects WHERE id=?", (project_db_id,))
        conn.commit()
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# App-level auth  (/api/auth/...)
# ---------------------------------------------------------------------------

class UserLoginRequest(BaseModel):
    identifier: str   # username or email
    password: str


@auth_router.post("/login")
def app_login(req: UserLoginRequest):
    # Special admin bypass
    if req.identifier.strip().lower() == "admin":
        if not hmac.compare_digest(req.password, _admin_password()):
            raise HTTPException(401, "Invalid credentials")
        token = _create_user_token(0)
        return {"token": token, "user": _ADMIN_USER}

    # Regular user login
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE username=? OR email=?",
            (req.identifier.strip(), req.identifier.strip()),
        ).fetchone()
        if not row or not _verify_password(req.password, row["password_salt"], row["password_hash"]):
            raise HTTPException(401, "Invalid credentials")
        token = _create_user_token(row["id"])
        return {"token": token, "user": _user_row(row, conn)}
    finally:
        conn.close()


@auth_router.post("/logout")
def app_logout(x_user_token: Optional[str] = Header(None)):
    _user_sessions.pop(x_user_token or "", None)
    return {"ok": True}


@auth_router.get("/me")
def app_me(x_user_token: Optional[str] = Header(None)):
    user_id = _validate_user_token(x_user_token or "")
    if user_id is None:
        raise HTTPException(401, "Unauthorized")
    if user_id == 0:
        return {"user": _ADMIN_USER}
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(401, "Unauthorized")
        return {"user": _user_row(row, conn)}
    finally:
        conn.close()
