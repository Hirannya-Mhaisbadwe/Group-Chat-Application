import asyncio
import base64
import json
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from typing import Dict, Optional

import bcrypt
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# App Setup
# ---------------------------------------------------------------------------
app = FastAPI(title="NexChat Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# AES-GCM Key  (load from env → file → generate fresh)
# ---------------------------------------------------------------------------
_KEY_FILE = os.path.join(os.path.dirname(__file__), "secret.key")

def _load_or_create_aes_key() -> bytes:
    env_val = os.environ.get("CHAT_AES_KEY", "").strip()
    if env_val:
        key = base64.b64decode(env_val)
        if len(key) == 32:
            print("[crypto] AES key loaded from environment variable.")
            return key
    if os.path.exists(_KEY_FILE):
        with open(_KEY_FILE, "rb") as f:
            key = f.read()
        if len(key) == 32:
            print(f"[crypto] AES key loaded from {_KEY_FILE}.")
            return key
    key = secrets.token_bytes(32)
    with open(_KEY_FILE, "wb") as f:
        f.write(key)
    print(f"[crypto] New AES key generated and saved to {_KEY_FILE}.")
    return key

AES_KEY = _load_or_create_aes_key()
AESGCM_CIPHER = AESGCM(AES_KEY)

# ---------------------------------------------------------------------------
# SQLite Database
# ---------------------------------------------------------------------------
_DB_PATH = os.path.join(os.path.dirname(__file__), "chat.db")

def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def _init_db():
    with _get_db() as conn:
        # Messages table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id     TEXT    NOT NULL DEFAULT 'main',
                sender      TEXT    NOT NULL,
                msg_type    TEXT    NOT NULL DEFAULT 'message',
                ciphertext  BLOB    NOT NULL,
                nonce       BLOB    NOT NULL,
                signature   BLOB,
                public_key  BLOB,
                reply_to    TEXT,
                timestamp   TEXT    NOT NULL
            )
        """)
        # Users table — registered accounts
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id             TEXT    NOT NULL UNIQUE,
                display_name        TEXT    NOT NULL,
                password_hash       TEXT    NOT NULL,
                created_at          TEXT    NOT NULL,
                last_seen_msg_id    INTEGER NOT NULL DEFAULT 0,
                last_seen_at        TEXT
            )
        """)
        # Sessions table — auth tokens
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token       TEXT    PRIMARY KEY,
                user_id     TEXT    NOT NULL,
                created_at  TEXT    NOT NULL
            )
        """)
        conn.commit()
    print(f"[db] Database ready at {_DB_PATH}.")

_init_db()

# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------
def create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with _get_db() as conn:
        # Remove old sessions for this user first
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)",
            (token, user_id, utc_now()),
        )
        conn.commit()
    return token

def validate_token(token: str) -> Optional[str]:
    """Return user_id if token is valid, else None."""
    with _get_db() as conn:
        row = conn.execute(
            "SELECT user_id FROM sessions WHERE token=?", (token,)
        ).fetchone()
    return row["user_id"] if row else None

# ---------------------------------------------------------------------------
# Message DB helpers
# ---------------------------------------------------------------------------
def save_message(
    room_id: str,
    sender: str,
    msg_type: str,
    plaintext: str,
    signature_b64: Optional[str],
    public_key_b64: Optional[str],
    reply_to: Optional[dict],
    timestamp: str,
) -> int:
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM_CIPHER.encrypt(nonce, plaintext.encode(), None)
    sig_bytes = base64.b64decode(signature_b64) if signature_b64 else None
    pk_bytes  = base64.b64decode(public_key_b64)  if public_key_b64  else None
    reply_json = json.dumps(reply_to) if reply_to else None

    with _get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO messages
               (room_id, sender, msg_type, ciphertext, nonce, signature, public_key, reply_to, timestamp)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (room_id, sender, msg_type, ciphertext, nonce, sig_bytes, pk_bytes, reply_json, timestamp),
        )
        conn.commit()
        return cursor.lastrowid

def get_max_msg_id(room_id: str = "main") -> int:
    with _get_db() as conn:
        row = conn.execute(
            "SELECT MAX(id) as max_id FROM messages WHERE room_id=?", (room_id,)
        ).fetchone()
    return row["max_id"] or 0

def get_history_since(room_id: str = "main", since_id: int = 0):
    rows = []
    first_ts = None
    with _get_db() as conn:
        # Join with users table to get the display_name of the sender
        cursor = conn.execute(
            """SELECT m.*, u.display_name 
               FROM messages m
               LEFT JOIN users u ON m.sender = u.user_id
               WHERE m.room_id=? AND m.id>? 
               ORDER BY m.id ASC""",
            (room_id, since_id),
        )
        for row in cursor.fetchall():
            try:
                plaintext = AESGCM_CIPHER.decrypt(
                    bytes(row["nonce"]), bytes(row["ciphertext"]), None
                ).decode()
            except Exception:
                continue

            if row["signature"] and row["public_key"]:
                try:
                    pub_key = serialization.load_der_public_key(bytes(row["public_key"]))
                    pub_key.verify(
                        bytes(row["signature"]),
                        plaintext.encode(),
                        ec.ECDSA(hashes.SHA256()),
                    )
                except Exception:
                    continue

            event: dict = {
                "type":      row["msg_type"],
                "username":  row["display_name"] or row["sender"], # fallback to user_id
                "user_id":   row["sender"],
                "message":   plaintext,
                "timestamp": row["timestamp"],
            }
            if row["reply_to"]:
                try:
                    event["reply_to"] = json.loads(row["reply_to"])
                except Exception:
                    pass

            if first_ts is None:
                first_ts = row["timestamp"]
            rows.append(event)

    return rows, len(rows), first_ts

def update_last_seen(user_id: str, msg_id: int):
    with _get_db() as conn:
        conn.execute(
            "UPDATE users SET last_seen_msg_id=?, last_seen_at=? WHERE user_id=?",
            (msg_id, utc_now(), user_id),
        )
        conn.commit()

# ---------------------------------------------------------------------------
# In-memory runtime state
# ---------------------------------------------------------------------------
clients: Dict[str, dict] = {}
known_sessions: Dict[str, float] = {}
disconnect_tasks: Dict[str, asyncio.Task] = {}
last_disconnect_time: float = 0.0


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _send(ws: WebSocket, payload: dict):
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def broadcast(payload: dict, exclude_token: Optional[str] = None):
    snapshot = list(clients.items())
    await asyncio.gather(
        *(
            _send(info["websocket"], payload)
            for token, info in snapshot
            if token != exclude_token
        ),
        return_exceptions=True,
    )


async def broadcast_all(payload: dict):
    await broadcast(payload, exclude_token=None)


async def push_user_list():
    users = [{"user_id": info["user_id"], "display_name": info["display_name"]} for info in clients.values()]
    await broadcast_all({"type": "users", "count": len(users), "users": users})

# ---------------------------------------------------------------------------
# HTTP Auth Endpoints
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    user_id: str
    display_name: str
    password: str

class LoginRequest(BaseModel):
    user_id: str
    password: str

@app.get("/check-user/{user_id}")
async def check_user(user_id: str):
    user_id = user_id.strip().lower()
    if not user_id:
        return {"available": False}
        
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        
    return {"available": row is None}

@app.post("/register")
async def register(req: RegisterRequest):
    user_id = req.user_id.strip()
    display_name = req.display_name.strip()
    password = req.password.strip()

    if not user_id or not display_name or not password:
        raise HTTPException(status_code=400, detail="All fields are required.")
    if len(user_id) > 20:
        raise HTTPException(status_code=400, detail="User ID must be 20 characters or fewer.")
    if len(display_name) > 30:
        raise HTTPException(status_code=400, detail="Display name must be 30 characters or fewer.")
    
    # Password rules
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if not any(char.isdigit() for char in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number.")

    with _get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE user_id=?", (user_id,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail="User ID already taken.")

        current_max = get_max_msg_id()
        conn.execute(
            "INSERT INTO users (user_id, display_name, password_hash, created_at, last_seen_msg_id) VALUES (?,?,?,?,?)",
            (user_id, display_name, hash_password(password), utc_now(), current_max),
        )
        conn.commit()

    token = create_session(user_id)
    return {"user_id": user_id, "display_name": display_name, "token": token}


@app.post("/login")
async def login(req: LoginRequest):
    user_id = req.user_id.strip()
    password = req.password.strip()

    with _get_db() as conn:
        row = conn.execute(
            "SELECT password_hash, display_name FROM users WHERE user_id=?", (user_id,)
        ).fetchone()

    if not row or not verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid User ID or password.")

    token = create_session(user_id)
    return {"user_id": user_id, "display_name": row["display_name"], "token": token}

# ---------------------------------------------------------------------------
# WebSocket Endpoint
# ---------------------------------------------------------------------------
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global last_disconnect_time
    await websocket.accept()

    session_token: Optional[str] = None
    user_id: Optional[str] = None
    display_name: Optional[str] = None

    try:
        raw = await websocket.receive_text()
        data = json.loads(raw)

        if data.get("type") != "join":
            await websocket.close(code=1008)
            return

        session_token  = (data.get("session_token") or "").strip()
        auth_token     = (data.get("auth_token")    or "").strip()
        public_key_b64 = data.get("public_key")

        # Validate auth token
        user_id = validate_token(auth_token) if auth_token else None
        if not user_id or not session_token:
            await _send(websocket, {"type": "error", "message": "Authentication failed. Please log in again."})
            await websocket.close(code=4001)
            return

        # Fetch display name
        with _get_db() as conn:
            user_row = conn.execute(
                "SELECT display_name, last_seen_msg_id, last_seen_at FROM users WHERE user_id=?",
                (user_id,)
            ).fetchone()
        
        display_name = user_row["display_name"]

        # Cancel any pending disconnect task
        has_actually_disconnected = True
        if session_token in disconnect_tasks:
            task = disconnect_tasks[session_token]
            if not task.done():
                task.cancel()
                has_actually_disconnected = False
            del disconnect_tasks[session_token]
        else:
            if session_token not in known_sessions:
                has_actually_disconnected = False

        is_reconnect  = False
        is_replacement = False

        if session_token in clients:
            is_reconnect   = True
            is_replacement = True
            old_ws = clients[session_token]["websocket"]
            try:
                await old_ws.send_text(json.dumps({
                    "type": "replaced",
                    "message": "You opened this chat in another tab. This tab is now active.",
                }))
                await old_ws.close(code=4000)
            except Exception:
                pass
        else:
            last_active = known_sessions.get(session_token, 0)
            if time.time() - last_active < 300:
                is_reconnect = True

        known_sessions[session_token] = time.time()
        clients[session_token] = {
            "websocket":     websocket,
            "user_id":       user_id,
            "display_name":  display_name,
            "public_key_b64": public_key_b64,
        }

        last_seen_id = user_row["last_seen_msg_id"] if user_row else 0
        last_seen_at = user_row["last_seen_at"]      if user_row else None

        history, unread_count, first_new_ts = get_history_since("main", last_seen_id)

        await _send(websocket, {
            "type":          "joined",
            "username":      display_name, # client expects username to display
            "user_id":       user_id,
            "unread_count":  unread_count,
            "since":         last_seen_at,
            "first_new_ts":  first_new_ts,
        })

        for msg in history:
            await _send(websocket, msg)

        if not is_replacement:
            if is_reconnect and has_actually_disconnected:
                ts = utc_now()
                reconnect_event = {"type": "system", "message": f"{display_name} reconnected", "timestamp": ts}
                save_message("main", user_id, "system", f"{display_name} reconnected", None, None, None, ts)
                await broadcast(reconnect_event, exclude_token=session_token)
            elif not is_reconnect:
                ts = utc_now()
                join_event = {"type": "system", "message": f"{display_name} joined the chat", "timestamp": ts}
                save_message("main", user_id, "system", f"{display_name} joined the chat", None, None, None, ts)
                await broadcast(join_event, exclude_token=session_token)

        await push_user_list()

        async for raw_msg in websocket.iter_text():
            data = json.loads(raw_msg)
            msg_type = data.get("type")

            if msg_type == "message":
                text      = data.get("message", "").strip()
                signature = data.get("signature")
                pk_b64    = data.get("public_key") or public_key_b64
                reply_to  = data.get("reply_to")
                ts        = utc_now()

                if not text:
                    continue

                if signature and pk_b64:
                    try:
                        sig_bytes = base64.b64decode(signature)
                        pk_bytes  = base64.b64decode(pk_b64)
                        pub_key   = serialization.load_der_public_key(pk_bytes)
                        pub_key.verify(sig_bytes, text.encode(), ec.ECDSA(hashes.SHA256()))
                    except InvalidSignature:
                        await _send(websocket, {
                            "type": "system",
                            "message": "⚠️ Your message was rejected: invalid signature.",
                            "timestamp": ts,
                        })
                        continue
                    except Exception as e:
                        print(f"[!] Signature error from {user_id}: {e}")

                save_message("main", user_id, "message", text, signature, pk_b64, reply_to, ts)

                chat_msg: dict = {
                    "type":      "message",
                    "username":  display_name,
                    "user_id":   user_id,
                    "message":   text,
                    "timestamp": ts,
                }
                if reply_to:
                    chat_msg["reply_to"] = reply_to
                await broadcast_all(chat_msg)

            elif msg_type == "leave":
                if session_token in clients and clients[session_token]["websocket"] is websocket:
                    del clients[session_token]
                if session_token in known_sessions:
                    del known_sessions[session_token]

                update_last_seen(user_id, get_max_msg_id())

                ts = utc_now()
                leave_event = {"type": "system", "message": f"{display_name} left the chat", "timestamp": ts}
                save_message("main", user_id, "system", f"{display_name} left the chat", None, None, None, ts)
                await broadcast_all(leave_event)
                await push_user_list()
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        pass
    finally:
        if (
            session_token
            and session_token in clients
            and clients[session_token]["websocket"] is websocket
        ):
            del clients[session_token]
            known_sessions[session_token] = time.time()

            async def delayed_disconnect():
                try:
                    await asyncio.sleep(6.0)
                    update_last_seen(user_id, get_max_msg_id())
                    ts = utc_now()
                    disconnect_event = {
                        "type":      "system",
                        "message":   f"{display_name} disconnected",
                        "timestamp": ts,
                    }
                    save_message("main", user_id, "system", f"{display_name} disconnected", None, None, None, ts)
                    await broadcast_all(disconnect_event)
                    await push_user_list()
                    if not clients:
                        global last_disconnect_time
                        last_disconnect_time = time.time()
                except asyncio.CancelledError:
                    pass
                finally:
                    disconnect_tasks.pop(session_token, None)

            disconnect_tasks[session_token] = asyncio.create_task(delayed_disconnect())
