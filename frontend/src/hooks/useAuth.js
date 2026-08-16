// useAuth.js — Handles register/login/logout with JWT
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export function getAccessToken() {
  return localStorage.getItem('chat_access_token');
}

export function getStoredUsername() {
  return localStorage.getItem('chat_username');
}

function storeAuth(token, username) {
  localStorage.setItem('chat_access_token', token);
  localStorage.setItem('chat_username', username);
}

export function clearAuth() {
  localStorage.removeItem('chat_access_token');
  localStorage.removeItem('chat_username');
  localStorage.removeItem('chat_session_token');
}

/**
 * Register a new user.
 * Returns { success: true } or throws an error with a message.
 */
export async function register(username, password) {
  const res = await fetch(`${API_BASE}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Registration failed.');
  return data;
}

/**
 * Log in an existing user.
 * Returns { username } or throws an error with a message.
 */
export async function login(username, password) {
  const res = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || 'Login failed.');
  storeAuth(data.access_token, data.username);
  return { username: data.username };
}
