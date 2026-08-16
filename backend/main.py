import asyncio
import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import JWTError, jwt
from passlib.context import CryptContext
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import load_der_public_key, Encoding, PublicFormat
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes

# ─────────────────────────────────────────────────────────────
# App & CORS
# ─────────────────────────────────────────────────────────────
app = FastAPI(title="NexChat Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─────────────────────────────────────────────────────────────
# JWT Config
# ─────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET", "nexchat-super-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours

# ─────────────────────────────────────────────────────────────
# Password hashing
# ─────────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ─────────────────────────────────────────────────────────────
# AES-GCM Key (persistent)
# ─────────────────────────────────────────────────────────────
KEY_FILE = "secret.key"

def get_aes_key() -> bytes:
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
    key = AESGCM.generate_key(bit_length=256)
    with open(KEY_FILE, "wb") as f:
        f.write(key)
    return key

AES_KEY = get_aes_key()

# ─────────────────────────────────────────────────────────────
# Database helpers
# ─────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect("chat.db")
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        username     TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        public_key   TEXT,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id    TEXT NOT NULL DEFAULT 'default',
        type       TEXT NOT NULL,
        sender     TEXT NOT NULL DEFAULT '',
        message    TEXT NOT NULL DEFAULT '',
        ciphertext TEXT NOT NULL DEFAULT '',
        nonce      TEXT NOT NULL DEFAULT '',
        signature  TEXT NOT NULL DEFAULT '',
        public_key TEXT NOT NULL DEFAULT '',
        timestamp  TEXT NOT NULL
    );
    """)
    conn.commit()
    conn.close()

init_db()

# ─────────────────────────────────────────────────────────────
# User DB helpers
# ─────────────────────────────────────────────────────────────
def db_create_user(username: str, password_hash: str):
    conn = get_db()
    conn.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash)
    )
    conn.commit()
    conn.close()

def db_get_user(username: str) -> Optional[dict]:
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def db_update_public_key(username: str, public_key: str):
    conn = get_db()
    conn.execute(
        "UPDATE users SET public_key = ? WHERE username = ?",
        (public_key, username)
    )
    conn.commit()
    conn.close()

# ─────────────────────────────────────────────────────────────
# Message DB helpers
# ─────────────────────────────────────────────────────────────
def save_message_to_db(room_id, msg_type, sender, message, ciphertext, nonce, signature, public_key, timestamp):
    conn = get_db()
    conn.execute("""
    INSERT INTO messages (room_id, type, sender, message, ciphertext, nonce, signature, public_key, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (room_id, msg_type, sender, message, ciphertext, nonce, signature, public_key, timestamp))
    conn.commit()
    conn.close()

def get_history_from_db(room_id: str = "default"):
    conn = get_db()
    rows = conn.execute("""
    SELECT type, sender, message, ciphertext, nonce, signature, public_key, timestamp
    FROM messages WHERE room_id = ? ORDER BY id ASC
    """, (room_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# ─────────────────────────────────────────────────────────────
# Crypto helpers
# ─────────────────────────────────────────────────────────────
def verify_signature(pub_key_hex: str, signature_hex: str, message: str) -> bool:
    if not pub_key_hex or not signature_hex:
        return False
    try:
        pub_key = load_der_public_key(bytes.fromhex(pub_key_hex))
        pub_key.verify(bytes.fromhex(signature_hex), message.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except Exception as e:
        print(f"[!] Signature verification failed: {e}")
        return False

def encrypt_message(message: str) -> tuple[str, str]:
    aes = AESGCM(AES_KEY)
    nonce = os.urandom(12)
    ct = aes.encrypt(nonce, message.encode(), None)
    return ct.hex(), nonce.hex()

def decrypt_message(ciphertext_hex: str, nonce_hex: str) -> str:
    aes = AESGCM(AES_KEY)
    return aes.decrypt(bytes.fromhex(nonce_hex), bytes.fromhex(ciphertext_hex), None).decode()

# ─────────────────────────────────────────────────────────────
# JWT helpers
# ─────────────────────────────────────────────────────────────
def create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str) -> Optional[str]:
    """Returns username if valid, None otherwise."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None

# ─────────────────────────────────────────────────────────────
# Pydantic models
# ─────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

# ─────────────────────────────────────────────────────────────
# REST Auth Endpoints
# ─────────────────────────────────────────────────────────────
@app.post("/register")
async def register(req: RegisterRequest):
    if not req.username.strip() or not req.password:
        raise HTTPException(status_code=400, detail="Username and password are required.")
    if len(req.username) > 20:
        raise HTTPException(status_code=400, detail="Username must be 20 characters or fewer.")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    if db_get_user(req.username):
        raise HTTPException(status_code=409, detail="Username already taken.")
    hashed = pwd_context.hash(req.password)
    db_create_user(req.username.strip(), hashed)
    return {"success": True, "message": "User registered successfully."}

@app.post("/login")
async def login(req: LoginRequest):
    user = db_get_user(req.username)
    if not user or not pwd_context.verify(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_access_token(req.username)
    return {"access_token": token, "username": req.username}

# ─────────────────────────────────────────────────────────────
# In-memory WebSocket state
# ─────────────────────────────────────────────────────────────
clients: Dict[str, dict] = {}          # session_token → {websocket, username}
known_sessions: Dict[str, float] = {}
disconnect_tasks: Dict[str, asyncio.Task] = {}
last_disconnect_time: float = 0.0

# ─────────────────────────────────────────────────────────────
# Utility helpers
# ─────────────────────────────────────────────────────────────
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
    users = [info["username"] for info in clients.values()]
    await broadcast_all({"type": "users", "count": len(users), "users": users})

def add_system_event(msg_type: str, message: str, timestamp: str):
    save_message_to_db("default", msg_type, "", message, "", "", "", "", timestamp)

async def send_history(websocket: WebSocket, room_id: str = "default"):
    rows = get_history_from_db(room_id)
    for row in rows:
        if row["type"] == "message":
            try:
                decrypted = decrypt_message(row["ciphertext"], row["nonce"])
                if not verify_signature(row["public_key"], row["signature"], decrypted):
                    decrypted = f"[⚠️ Tampered: Signature invalid] (original from {row['sender']})"
            except Exception:
                decrypted = f"[⚠️ Tampered: Integrity check failed] (original from {row['sender']})"
            await _send(websocket, {
                "type": "message",
                "username": row["sender"],
                "message": decrypted,
                "timestamp": row["timestamp"]
            })
        elif row["type"] == "system":
            await _send(websocket, {
                "type": "system",
                "message": row["message"],
                "timestamp": row["timestamp"]
            })

def _clear_room():
    print("[i] Room empty — database history remains persistent")

# ─────────────────────────────────────────────────────────────
# WebSocket endpoint
# ─────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    global last_disconnect_time
    await websocket.accept()

    session_token: Optional[str] = None
    username: Optional[str] = None

    try:
        raw = await websocket.receive_text()
        data = json.loads(raw)

        if data.get("type") != "join":
            await websocket.close(code=1008)
            return

        # ── JWT Authentication ──────────────────────────────
        token = (data.get("token") or "").strip()
        authenticated_user = verify_token(token)
        if not authenticated_user:
            await _send(websocket, {"type": "error", "message": "Authentication failed. Please log in again."})
            await websocket.close(code=1008)
            return

        username = authenticated_user
        session_token = (data.get("session_token") or "").strip()
        public_key = (data.get("public_key") or "").strip()

        if not session_token:
            await websocket.close(code=1008)
            return

        # Store/update user's public key in DB
        if public_key:
            db_update_public_key(username, public_key)

        # If the room was completely empty, check if we should clear stale history
        if not clients:
            if time.time() - last_disconnect_time >= 300:
                _clear_room()
                known_sessions.clear()

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

        is_reconnect = False
        is_replacement = False

        if session_token in clients:
            is_reconnect = True
            is_replacement = True
            old_ws = clients[session_token]["websocket"]
            try:
                await old_ws.send_text(json.dumps({
                    "type": "replaced",
                    "message": "You opened this chat in another tab. This tab is now active."
                }))
                await old_ws.close(code=4000)
            except Exception:
                pass
        else:
            last_active = known_sessions.get(session_token, 0)
            if time.time() - last_active < 300:
                is_reconnect = True

        # Register the client
        known_sessions[session_token] = time.time()
        clients[session_token] = {"websocket": websocket, "username": username, "public_key": public_key}
        print(f"[+] {username} connected  (token …{session_token[-8:]})")
        await _send(websocket, {"type": "joined", "username": username})

        # Send history to joining client
        await send_history(websocket, "default")

        # Broadcast join/reconnect event
        if is_reconnect:
            if not is_replacement and has_actually_disconnected:
                ts = utc_now()
                add_system_event("system", f"{username} reconnected", ts)
                await broadcast({"type": "system", "message": f"{username} reconnected", "timestamp": ts}, exclude_token=session_token)
        else:
            ts = utc_now()
            add_system_event("system", f"{username} joined the chat", ts)
            await broadcast({"type": "system", "message": f"{username} joined the chat", "timestamp": ts}, exclude_token=session_token)

        await push_user_list()

        # ── Message loop ────────────────────────────────────
        async for raw_msg in websocket.iter_text():
            data = json.loads(raw_msg)
            msg_type = data.get("type")

            if msg_type == "message":
                msg_text = data.get("message", "")
                sig_hex = data.get("signature", "")
                pub_key_hex = data.get("public_key", "")

                # Verify signature (authenticity check)
                if not verify_signature(pub_key_hex, sig_hex, msg_text):
                    print(f"[!] Rejected message from {username} — invalid signature")
                    continue

                # Encrypt before storing (confidentiality + integrity)
                ciphertext_hex, nonce_hex = encrypt_message(msg_text)
                timestamp = utc_now()
                save_message_to_db("default", "message", username, "", ciphertext_hex, nonce_hex, sig_hex, pub_key_hex, timestamp)

                chat_msg = {
                    "type": "message",
                    "username": username,
                    "message": msg_text,
                    "timestamp": timestamp,
                }
                if "reply_to" in data:
                    chat_msg["reply_to"] = data["reply_to"]
                await broadcast_all(chat_msg)

            elif msg_type == "leave":
                if session_token in clients and clients[session_token]["websocket"] is websocket:
                    del clients[session_token]
                if session_token in known_sessions:
                    del known_sessions[session_token]

                ts = utc_now()
                add_system_event("system", f"{username} left the chat", ts)
                await broadcast_all({"type": "system", "message": f"{username} left the chat", "timestamp": ts})
                await push_user_list()

                if not clients:
                    last_disconnect_time = time.time()
                    _clear_room()
                break

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[!] Unexpected error: {exc}")

    finally:
        if (
            session_token
            and session_token in clients
            and clients[session_token]["websocket"] is websocket
        ):
            del clients[session_token]
            known_sessions[session_token] = time.time()
            print(f"[-] {username} disconnected  (token …{session_token[-8:]})")

            async def delayed_disconnect():
                try:
                    await asyncio.sleep(6.0)
                    ts = utc_now()
                    add_system_event("system", f"{username} disconnected", ts)
                    await broadcast_all({"type": "system", "message": f"{username} disconnected", "timestamp": ts})
                    await push_user_list()
                    if not clients:
                        global last_disconnect_time
                        last_disconnect_time = time.time()
                except asyncio.CancelledError:
                    pass
                finally:
                    disconnect_tasks.pop(session_token, None)

            disconnect_tasks[session_token] = asyncio.create_task(delayed_disconnect())
