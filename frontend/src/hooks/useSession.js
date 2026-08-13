//  useSession — localStorage-based session management
//
//  Keys used:
//    chat_session_token  → permanent UUID per browser (never cleared)
//    chat_username       → username string (cleared on leave / timeout)
//    chat_joined_at      → unix-ms timestamp  (cleared on leave / timeout)

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Returns (or creates) the permanent browser-level session token.
// This is shared across all tabs in the same browser, so the server
// can detect and deduplicate same-browser connections.
export function getOrCreateSessionToken() {
  let token = localStorage.getItem('chat_session_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('chat_session_token', token);
  }
  return token;
}

// Returns { username } if the session is still valid, otherwise null.
// A session is valid if it exists and was created < SESSION_TIMEOUT_MS ago.
export function getSavedSession() {
  const username = localStorage.getItem('chat_username');
  const joinedAt = localStorage.getItem('chat_joined_at');

  if (!username || !joinedAt) return null;

  const elapsed = Date.now() - parseInt(joinedAt, 10);
  if (elapsed > SESSION_TIMEOUT_MS) {
    clearSession();
    return null;
  }

  return { username };
}

// Persist the username and current timestamp.
export function saveSession(username) {
  localStorage.setItem('chat_username', username);
  localStorage.setItem('chat_joined_at', String(Date.now()));
}

// Keep the session alive while the user is actively chatting
export function refreshSession() {
  if (localStorage.getItem('chat_username')) {
    localStorage.setItem('chat_joined_at', String(Date.now()));
  }
}

// Remove username + timestamp (keeps session_token for dedup).
export function clearSession() {
  localStorage.removeItem('chat_username');
  localStorage.removeItem('chat_joined_at');
}

// How many seconds remain in the current session (0 if expired/absent).
export function sessionSecondsRemaining() {
  const joinedAt = localStorage.getItem('chat_joined_at');
  if (!joinedAt) return 0;
  const remaining = SESSION_TIMEOUT_MS - (Date.now() - parseInt(joinedAt, 10));
  return Math.max(0, Math.floor(remaining / 1000));
}
