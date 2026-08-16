export function getOrCreateSessionToken() {
  let token = localStorage.getItem('chat_session_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('chat_session_token', token);
  }
  return token;
}

export function getSavedSession() {
  const userId = localStorage.getItem('chat_user_id');
  const displayName = localStorage.getItem('chat_display_name');
  const authToken = localStorage.getItem('chat_auth_token');
  if (!userId || !authToken) return null;
  return { userId, displayName, authToken };
}

export function saveSession(userId, displayName, authToken) {
  localStorage.setItem('chat_user_id', userId);
  localStorage.setItem('chat_display_name', displayName || userId);
  localStorage.setItem('chat_auth_token', authToken);
}

export function clearSession() {
  localStorage.removeItem('chat_user_id');
  localStorage.removeItem('chat_display_name');
  localStorage.removeItem('chat_auth_token');
}

export function refreshSession() {}
