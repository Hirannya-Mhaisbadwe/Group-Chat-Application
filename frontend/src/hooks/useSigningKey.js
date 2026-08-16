// Client-side ECDSA signing key management.
//
// Each browser gets its own signing key pair.
// The private key never leaves the browser.
// The public key can later be sent to the server
// and stored alongside the user's messages.

const PRIVATE_KEY_STORAGE = 'chat_signing_private_key';
const PUBLIC_KEY_STORAGE = 'chat_signing_public_key';

// Convert ArrayBuffer → Base64
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

// Convert Base64 → ArrayBuffer
function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

// Generate a new ECDSA signing key pair.
export async function generateSigningKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  );

  const privateKey = await crypto.subtle.exportKey(
    'pkcs8',
    keyPair.privateKey
  );

  const publicKey = await crypto.subtle.exportKey(
    'spki',
    keyPair.publicKey
  );

  localStorage.setItem(
    PRIVATE_KEY_STORAGE,
    bufferToBase64(privateKey)
  );

  localStorage.setItem(
    PUBLIC_KEY_STORAGE,
    bufferToBase64(publicKey)
  );

  return keyPair;
}

// Get the existing key pair or create one if this is
// the first time the browser is using the chat.
export async function getOrCreateSigningKeyPair() {
  const savedPrivateKey = localStorage.getItem(PRIVATE_KEY_STORAGE);
  const savedPublicKey = localStorage.getItem(PUBLIC_KEY_STORAGE);

  if (savedPrivateKey && savedPublicKey) {
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      base64ToBuffer(savedPrivateKey),
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['sign']
    );

    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBuffer(savedPublicKey),
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['verify']
    );

    return { privateKey, publicKey };
  }

  return generateSigningKeyPair();
}

// Sign a message using the browser's private key.
export async function signMessage(message, privateKey) {
  const encodedMessage = new TextEncoder().encode(message);

  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
    privateKey,
    encodedMessage
  );

  return bufferToBase64(signature);
}

// Return the stored public key so it can later be
// sent to the backend.
export function getPublicSigningKey() {
  return localStorage.getItem(PUBLIC_KEY_STORAGE);
}
// Verify that a message was signed by the owner of the public key.
export async function verifyMessage(message, signatureBase64, publicKeyBase64) {
  try {
    if (!message || !signatureBase64 || !publicKeyBase64) {
      return false;
    }

    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBuffer(publicKeyBase64),
      {
        name: 'ECDSA',
        namedCurve: 'P-256',
      },
      true,
      ['verify']
    );

    const signature = base64ToBuffer(signatureBase64);
    const encodedMessage = new TextEncoder().encode(message);

    return await crypto.subtle.verify(
      {
        name: 'ECDSA',
        hash: 'SHA-256',
      },
      publicKey,
      signature,
      encodedMessage
    );
  } catch (error) {
    console.error('[Security] Signature verification failed:', error);
    return false;
  }
}
