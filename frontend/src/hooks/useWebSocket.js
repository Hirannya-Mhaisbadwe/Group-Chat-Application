import { useEffect, useRef, useCallback, useState } from 'react';
import { getOrCreateSessionToken, clearSession } from './useSession';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws';

// Possible connection states
export const WS_STATUS = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  REPLACED: 'replaced',   // same browser, different tab took over
};

/**
 * useWebSocket
 *
 * @param {string|null} username  – Pass a username to open the connection,
 *                                  null to keep it closed.
 * @param {object} callbacks
 *   onMessage(msg)   – called for every incoming chat/system/users packet
 *   onJoined()       – called once the server confirms the join
 *   onReplaced()     – called when another tab in the same browser takes over
 *   onDisconnected() – called on unexpected disconnect
 */
export function useWebSocket(username, { onMessage, onJoined, onReplaced, onDisconnected } = {}) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState(WS_STATUS.IDLE);

  // Stable refs so the WS callbacks don't capture stale closures
  const cbRef = useRef({ onMessage, onJoined, onReplaced, onDisconnected });
  useEffect(() => {
    cbRef.current = { onMessage, onJoined, onReplaced, onDisconnected };
  });
  useEffect(() => {
    if (!username) return;

    const sessionToken = getOrCreateSessionToken();
    setStatus(WS_STATUS.CONNECTING);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join',
        session_token: sessionToken,
        username,
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

      cbRef.current.onMessage?.(data);
    };

    ws.onclose = (event) => {
      // code 4000 = replaced by another tab (we handled it above already)
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
      // Cleanup on unmount or username change — close silently
      ws.onclose = null;
      ws.close();
    };
  }, [username]);
  const sendMessage = useCallback((text) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'message', message: text }));
    }
  }, []);
  const leaveChat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.onclose = null; // prevent disconnect event
      wsRef.current.close();
    }
    clearSession();
    setStatus(WS_STATUS.IDLE);
  }, []);

  return { status, sendMessage, leaveChat };
}
