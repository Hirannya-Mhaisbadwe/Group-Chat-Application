/**
 * useCrypto
 *
 * Generates an ECDSA P-256 keypair on mount (per browser session).
 * Exposes:
 *   publicKeyB64  – base64-encoded SPKI public key (sent to server on join/message)
 *   sign(text)    – signs a UTF-8 string; returns a base64 signature
 *   ready         – true once the keypair has been generated
 */
import { useEffect, useRef, useState } from 'react';

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGO = { name: 'ECDSA', hash: { name: 'SHA-256' } };

export function useCrypto() {
  const keyPairRef = useRef(null);
  const [publicKeyB64, setPublicKeyB64] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      try {
        const keyPair = await window.crypto.subtle.generateKey(
          ALGO,
          false,          // private key is NOT extractable
          ['sign', 'verify']
        );

        if (cancelled) return;
        keyPairRef.current = keyPair;

        // Export public key as SPKI → base64 so we can send it over the wire
        const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const b64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

        if (cancelled) return;
        setPublicKeyB64(b64);
        setReady(true);
      } catch (err) {
        console.error('[useCrypto] Key generation failed:', err);
      }
    }

    generate();
    return () => { cancelled = true; };
  }, []);

  /**
   * Sign a plaintext string with the session private key.
   * Returns a base64-encoded DER signature, or null if not yet ready.
   */
  async function sign(text) {
    if (!keyPairRef.current) return null;
    const encoded = new TextEncoder().encode(text);
    const sigBuf = await window.crypto.subtle.sign(
      SIGN_ALGO,
      keyPairRef.current.privateKey,
      encoded
    );
    return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  }

  return { ready, publicKeyB64, sign };
}
