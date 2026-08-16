import asyncio
import json
from datetime import datetime, timezone
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="NexChat Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
import os
import sqlite3
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# In-memory state
# clients: session_token → {websocket, username}
clients: Dict[str, dict] = {}
known_sessions: Dict[str, float] = {}
disconnect_tasks: Dict[str, asyncio.Task] = {}
last_disconnect_time: float = 0.0

KEY_FILE = "secret.key"

def get_aes_key() -> bytes:
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "rb") as f:
            return f.read()
    else:
        key = AESGCM.generate_key(bit_length=256)
        with open(KEY_FILE, "wb") as f:
            f.write(key)
        return key

AES_KEY = get_aes_key()

def init_db():
    conn = sqlite3.connect("chat.db")
    conn.execute("""
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT,
        type TEXT,
        sender TEXT,
        message TEXT,
        ciphertext TEXT,
        nonce TEXT,
        signature TEXT,
        public_key TEXT,
        timestamp TEXT
    )
    """)
    conn.commit()
    conn.close()

init_db()

def save_message_to_db(room_id: str, msg_type: str, sender: str, message: str, ciphertext: str, nonce: str, signature: str, public_key: str, timestamp: str):
    conn = sqlite3.connect("chat.db")
    conn.execute("""
    INSERT INTO messages (room_id, type, sender, message, ciphertext, nonce, signature, public_key, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (room_id, msg_type, sender, message, ciphertext, nonce, signature, public_key, timestamp))
    conn.commit()
    conn.close()

def get_history_from_db(room_id: str = "default"):
    conn = sqlite3.connect("chat.db")
    cursor = conn.execute("""
    SELECT type, sender, message, ciphertext, nonce, signature, public_key, timestamp
    FROM messages
    WHERE room_id = ?
    ORDER BY id ASC
    """, (room_id,))
    rows = cursor.fetchall()
    conn.close()
    return rows

from cryptography.hazmat.primitives.serialization import load_der_public_key
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes

def verify_signature(pub_key_hex: str, signature_hex: str, message: str) -> bool:
    if not pub_key_hex or not signature_hex:
        return False
    try:
        pub_key_bytes = bytes.fromhex(pub_key_hex)
        public_key = load_der_public_key(pub_key_bytes)
        signature = bytes.fromhex(signature_hex)
        public_key.verify(
            signature,
            message.encode(),
            ec.ECDSA(hashes.SHA256())
        )
        return True
    except Exception as e:
        print(f"[!] Signature verification failed: {e}")
        return False

def encrypt_message(aes_key: bytes, message: str) -> tuple[str, str]:
    aes = AESGCM(aes_key)
    nonce = os.urandom(12)
    ciphertext = aes.encrypt(nonce, message.encode(), None)
    return ciphertext.hex(), nonce.hex()

def decrypt_message(aes_key: bytes, ciphertext_hex: str, nonce_hex: str) -> str:
    aes = AESGCM(aes_key)
    ciphertext = bytes.fromhex(ciphertext_hex)
    nonce = bytes.fromhex(nonce_hex)
    plaintext = aes.decrypt(nonce, ciphertext, None)
    return plaintext.decode()


def utc_now() -> str:
    """Return current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
#  Helpers

async def _send(ws: WebSocket, payload: dict):
    """Fire-and-forget send to a single socket."""
    try:
        await ws.send_text(json.dumps(payload))
    except Exception:
        pass


async def broadcast(payload: dict, exclude_token: Optional[str] = None):
    """Send to all connected clients, optionally excluding one session."""
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
    """Send to every connected client."""
    await broadcast(payload, exclude_token=None)


async def push_user_list():
    """Broadcast the current online-user list to all clients."""
    users = [info["username"] for info in clients.values()]
    await broadcast_all({"type": "users", "count": len(users), "users": users})


def add_to_history(event: dict):
    save_message_to_db(
        "default",
        event.get("type", "system"),
        event.get("username", ""),
        event.get("message", ""),
        "",  # ciphertext
        "",  # nonce
        "",  # signature
        "",  # public_key
        event.get("timestamp", utc_now())
    )

def _clear_room():
    print("[i] Room empty — database history remains persistent")

async def send_history(websocket: WebSocket, room_id: str = "default"):
    rows = get_history_from_db(room_id)
    for row in rows:
        msg_type, sender, message, ciphertext_hex, nonce_hex, signature_hex, public_key_hex, timestamp = row
        if msg_type == "message":
            try:
                # 1. Decrypt ciphertext using AES-GCM (verifies integrity)
                decrypted_msg = decrypt_message(AES_KEY, ciphertext_hex, nonce_hex)
                
                # 2. Verify signature using the sender's public key (verifies authenticity)
                if not verify_signature(public_key_hex, signature_hex, decrypted_msg):
                    print(f"[!] Warning: History message signature verification failed for sender {sender}")
                    decrypted_msg = f"[Tampered Message: Signature verification failed] (Was: {decrypted_msg})"
            except Exception as e:
                print(f"[!] Error decrypting/verifying history message: {e}")
                decrypted_msg = "[Tampered Message: Integrity check failed]"
            
            await _send(websocket, {
                "type": "message",
                "username": sender,
                "message": decrypted_msg,
                "timestamp": timestamp
            })
        elif msg_type == "system":
            await _send(websocket, {
                "type": "system",
                "message": message,
                "timestamp": timestamp
            })
#  WebSocket endpoint

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

        session_token = (data.get("session_token") or "").strip()
        username = (data.get("username") or "").strip()
        public_key = (data.get("public_key") or "").strip()

        if not session_token or not username:
            await websocket.close(code=1008)
            return
        import time

        # If the room was completely empty, check if we should clear stale history
        if not clients:
            # Clear history if it's been empty for > 5 minutes
            if time.time() - last_disconnect_time >= 300:
                _clear_room()
                known_sessions.clear()

        # Cancel any pending disconnect task for this session
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

        # Determine if this is a reconnect or tab replacement
        is_reconnect = False
        is_replacement = False

        if session_token in clients:
            is_reconnect = True
            is_replacement = True
            #   If this session_token already has an active connection
            #   (another tab), close the old one silently and take over.
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

        # Send message history
        await send_history(websocket, "default")
        
        if is_reconnect:
            # If they disconnected previously (not just replacing active tab or fast refreshing), let others know they reconnected
            if not is_replacement and has_actually_disconnected:
                reconnect_event = {
                    "type": "system",
                    "message": f"{username} reconnected",
                    "timestamp": utc_now(),
                }
                add_to_history(reconnect_event)
                await broadcast(reconnect_event, exclude_token=session_token)
        else:
            # Genuine new join
            join_event = {
                "type": "system",
                "message": f"{username} joined the chat",
                "timestamp": utc_now(),
            }
            add_to_history(join_event)
            await broadcast(join_event, exclude_token=session_token)

        # Push fresh user list to all
        await push_user_list()
        async for raw_msg in websocket.iter_text():
            data = json.loads(raw_msg)
            msg_type = data.get("type")

            if msg_type == "message":
                msg_text = data.get("message", "")
                sig_hex = data.get("signature", "")
                pub_key_hex = data.get("public_key", "")

                # Verify signature
                if not verify_signature(pub_key_hex, sig_hex, msg_text):
                    print(f"[!] Invalid signature from user {username}")
                    continue

                # Encrypt message before storing
                ciphertext_hex, nonce_hex = encrypt_message(AES_KEY, msg_text)

                # Store message in DB
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
                # Explicit leave — remove completely so they can't bypass login
                if session_token in clients and clients[session_token]["websocket"] is websocket:
                    del clients[session_token]
                if session_token in known_sessions:
                    del known_sessions[session_token]

                leave_event = {
                    "type": "system",
                    "message": f"{username} left the chat",
                    "timestamp": utc_now(),
                }
                add_to_history(leave_event)
                await broadcast_all(leave_event)
                await push_user_list()

                if not clients:
                    last_disconnect_time = time.time()
                    _clear_room()

                break  # exit loop, finally will not re-broadcast

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[!] Unexpected error: {exc}")

    finally:
        #   Only remove + notify if this websocket is still the active
        #   one for its session (not already replaced by another tab).
        if (
            session_token
            and session_token in clients
            and clients[session_token]["websocket"] is websocket
        ):
            del clients[session_token]
            known_sessions[session_token] = time.time()
            print(f"[-] {username} disconnected  (token …{session_token[-8:]})")

            # Start a delayed disconnect task so we don't spam disconnect/reconnect messages on page refresh
            async def delayed_disconnect():
                try:
                    await asyncio.sleep(6.0)  # Wait 6 seconds for potential reconnect
                    # Broadcast disconnect event
                    disconnect_event = {
                        "type": "system",
                        "message": f"{username} disconnected",
                        "timestamp": utc_now(),
                    }
                    add_to_history(disconnect_event)
                    await broadcast_all(disconnect_event)
                    await push_user_list()

                    # If the room is now empty, record disconnect time so we can clear history later if no one returns
                    if not clients:
                        global last_disconnect_time
                        last_disconnect_time = time.time()
                except asyncio.CancelledError:
                    pass
                finally:
                    disconnect_tasks.pop(session_token, None)

            disconnect_tasks[session_token] = asyncio.create_task(delayed_disconnect())
