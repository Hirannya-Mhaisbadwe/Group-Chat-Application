// Client-side cryptographic helper functions using Web Crypto API

/**
 * Generates an ECDSA key pair using the P-256 curve.
 * @returns {Promise<CryptoKeyPair>} The generated key pair.
 */
export async function generateSigningKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true, // extractable
    ["sign", "verify"]
  );
}

/**
 * Exports a CryptoKey to a Hex string in SPKI format.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>} Hex representation of the SPKI public key.
 */
export async function exportPublicKeyHex(publicKey) {
  const exported = await window.crypto.subtle.exportKey("spki", publicKey);
  const hashArray = Array.from(new Uint8Array(exported));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signs a plaintext message using the private key.
 * @param {CryptoKey} privateKey
 * @param {string} messageText
 * @returns {Promise<string>} Hex representation of the signature.
 */
export async function signMessage(privateKey, messageText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(messageText);
  const signature = await window.crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" },
    },
    privateKey,
    data
  );
  const hashArray = Array.from(new Uint8Array(signature));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
