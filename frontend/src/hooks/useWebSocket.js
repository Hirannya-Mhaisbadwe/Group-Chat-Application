import { useEffect, useRef, useCallback, useState } from 'react';
import { getOrCreateSessionToken, clearSession } from './useSession';
import {
  getOrCreateSigningKeyPair,
  signMessage,
  getPublicSigningKey,
  verifyMessage,
} from './useSigningKey';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws';

// Possible connection states
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
 * @param {string|null} username
 * @param {object} callbacks
 */
export function useWebSocket(
  username,
  { onMessage, onJoined, onReplaced, onDisconnected } = {}
) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState(WS_STATUS.IDLE);

  // Keep callbacks up to date without recreating the WebSocket
  const cbRef = useRef({
    onMessage,
    onJoined,
    onReplaced,
    onDisconnected,
  });

  useEffect(() => {
    cbRef.current = {
      onMessage,
      onJoined,
      onReplaced,
      onDisconnected,
    };
  });

  useEffect(() => {
    if (!username) return;

    const sessionToken = getOrCreateSessionToken();
    setStatus(WS_STATUS.CONNECTING);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    // Connection opened
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'join',
          session_token: sessionToken,
          username,
        })
      );
    };

    // Messages received
    ws.onmessage = async (event) => {
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

      // Verify signed chat messages
      if (data.type === 'message' && data.signature && data.public_key) {
        const isVerified = await verifyMessage(
          data.message,
          data.signature,
          data.public_key
        );

        data.signature_verified = isVerified;
      }

      cbRef.current.onMessage?.(data);
    };

    // Connection closed
    ws.onclose = (event) => {
      // Code 4000 means another tab replaced this connection
      if (event.code !== 4000) {
        setStatus(WS_STATUS.DISCONNECTED);
        cbRef.current.onDisconnected?.();
      }
    };

    // Connection error
    ws.onerror = (err) => {
      console.error('[WS] error:', err);
      setStatus(WS_STATUS.DISCONNECTED);
    };

    // Cleanup
    return () => {
      ws.onclose = null;
      ws.close();
    };
  }, [username]);

  // Send a signed message
  const sendMessage = useCallback(async (text, replyTo = null) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    try {
      // Get this user's signing key
      const { privateKey } = await getOrCreateSigningKeyPair();

      // Create digital signature
      const signature = await signMessage(text, privateKey);

      // Get public key
      const publicKey = getPublicSigningKey();

      const payload = {
        type: 'message',
        message: text,
        signature,
        public_key: publicKey,
      };

      // Preserve existing reply functionality
      if (replyTo) {
        payload.reply_to = {
          username: replyTo.username,
          message: replyTo.message,
        };
      }

      wsRef.current.send(JSON.stringify(payload));
    } catch (error) {
      console.error('[Security] Failed to sign message:', error);
    }
  }, []);

  // Leave chat
  const leaveChat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'leave' }));
      wsRef.current.onclose = null;
      wsRef.current.close();
    }

    clearSession();
    setStatus(WS_STATUS.IDLE);
  }, []);

  return {
    status,
    sendMessage,
    leaveChat,
  };
}
