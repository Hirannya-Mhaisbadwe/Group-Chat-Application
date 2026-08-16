import { useEffect, useRef, useCallback, useState } from 'react';
import { getOrCreateSessionToken, clearSession } from './useSession';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws';

export const WS_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  REPLACED: 'replaced',
};

/**
 * useWebSocket
 *
 * @param {string|null} username   – display name (also sent for legacy compat)
 * @param {object}      crypto     – { publicKeyB64, sign } from useCrypto
 * @param {string|null} authToken  – server-issued auth token from login/register
 * @param {object}      callbacks
 */
export function useWebSocket(username, crypto, authToken, { onMessage, onJoined, onReplaced, onDisconnected } = {}) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState(WS_STATUS.IDLE);

  const cbRef = useRef({ onMessage, onJoined, onReplaced, onDisconnected });
  useEffect(() => {
    cbRef.current = { onMessage, onJoined, onReplaced, onDisconnected };
  });

  const cryptoRef = useRef(crypto);
  useEffect(() => { cryptoRef.current = crypto; });

  useEffect(() => {
    if (!username || !authToken) return;

    const sessionToken = getOrCreateSessionToken();
    setStatus(WS_STATUS.CONNECTING);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type:          'join',
        session_token: sessionToken,
        auth_token:    authToken,
        username,                              // kept for display/compat
        public_key:    cryptoRef.current?.publicKeyB64 ?? null,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'joined') {
        setStatus(WS_STATUS.CONNECTED);
        cbRef.current.onJoined?.(data);
        return;
      }
      if (data.type === 'replaced') {
        setStatus(WS_STATUS.REPLACED);
        cbRef.current.onReplaced?.(data);
        return;
      }
      if (data.type === 'error') {
        // Auth failure — force back to login
        setStatus(WS_STATUS.DISCONNECTED);
        clearSession();
        cbRef.current.onDisconnected?.();
        return;
      }
      cbRef.current.onMessage?.(data);
    };

    ws.onclose = (event) => {
      if (event.code !== 4000) {
        setStatus(WS_STATUS.DISCONNECTED);
        cbRef.current.onDisconnected?.();
      }
    };

    ws.onerror = (err) => {
      console.error('[WS] error:', err);
      setStatus(WS_STATUS.DISCONNECTED);
    };

    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [username, authToken]);

  const sendMessage = useCallback(async (text, replyTo = null) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    const { sign, publicKeyB64 } = cryptoRef.current ?? {};
    let signature = null;
    try {
      if (sign) signature = await sign(text);
    } catch (err) {
      console.error('[WS] Signing failed:', err);
    }

    const payload = {
      type:       'message',
      message:    text,
      signature:  signature,
      public_key: publicKeyB64 ?? null,
    };
    if (replyTo) {
      payload.reply_to = { username: replyTo.username, message: replyTo.message };
    }
    wsRef.current.send(JSON.stringify(payload));
  }, []);

  const leaveChat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    clearSession();
    setStatus(WS_STATUS.IDLE);
  }, []);

  return { status, sendMessage, leaveChat };
}
