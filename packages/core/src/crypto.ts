import type { Envelope } from "@zuulpass/api-types";
import { base64ToBytes, bytesToBase64, utf8ToBytes } from "./bytes.js";

/** WebCrypto primitives used by the key hierarchy (docs/architecture.md §3). */
export const HMAC_SHA256 = "SHA-256" as const;
export const MASTER_KEY_BYTES = 32;
export const USK_BYTES = 32;
export const NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

/**
 * Generate `n` cryptographically secure random bytes.
 * @param n - Number of bytes to generate.
 * @returns A new array of `n` random bytes.
 */
export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Derive a key from a password with PBKDF2-HMAC-SHA256.
 * @param password - The password to derive from.
 * @param salt - The PBKDF2 salt.
 * @param iterations - The PBKDF2 iteration count.
 * @param length - Output length in bytes (defaults to 32).
 * @returns The derived key bytes.
 */
export async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  length = MASTER_KEY_BYTES,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: HMAC_SHA256, salt, iterations },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Expand key material with HKDF-SHA256. An empty salt is expanded to HashLen
 * zero bytes per RFC 5869 (WebCrypto accepts `new Uint8Array(0)`).
 * @param ikm - The input keying material.
 * @param salt - The HKDF salt.
 * @param info - The HKDF context/info; a string is UTF-8 encoded.
 * @param length - Output length in bytes (defaults to 32).
 * @returns The derived subkey bytes.
 */
export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string | Uint8Array,
  length = MASTER_KEY_BYTES,
): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const infoBytes = typeof info === "string" ? utf8ToBytes(info) : info;
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: HMAC_SHA256, salt, info: infoBytes },
    keyMaterial,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypt plaintext with AES-256-GCM. WebCrypto appends the 16-byte tag to the
 * ciphertext, so `ct` in the envelope is ciphertext||tag.
 * @param keyBytes - A 32-byte AES key.
 * @param plaintext - The bytes to encrypt.
 * @param nonce - A 12-byte nonce; a random one is generated when omitted
 * (overridable for deterministic known-answer tests).
 * @returns The ciphertext envelope.
 * @throws If the key is not 32 bytes or the nonce is not 12 bytes.
 */
export async function aesGcmEncrypt(
  keyBytes: Uint8Array,
  plaintext: Uint8Array,
  nonce = randomBytes(NONCE_BYTES),
): Promise<Envelope> {
  if (keyBytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`AES-256-GCM requires a ${MASTER_KEY_BYTES}-byte key`);
  }
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`AES-256-GCM requires a ${NONCE_BYTES}-byte nonce`);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "encrypt",
  ]);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    plaintext,
  );
  return {
    v: 1,
    alg: "AES-256-GCM",
    nonce: bytesToBase64(nonce),
    ct: bytesToBase64(new Uint8Array(ct)),
  };
}

/**
 * Decrypt an AES-256-GCM envelope.
 * @param keyBytes - A 32-byte AES key.
 * @param envelope - The envelope to decrypt.
 * @returns The decrypted plaintext bytes.
 * @throws If the envelope version/algorithm is unsupported, the key or nonce
 * length is wrong, or GCM authentication fails (wrong key / tampered input).
 */
export async function aesGcmDecrypt(
  keyBytes: Uint8Array,
  envelope: Envelope,
): Promise<Uint8Array> {
  if (envelope.v !== 1 || envelope.alg !== "AES-256-GCM") {
    throw new Error("unsupported envelope version/algorithm");
  }
  if (keyBytes.length !== MASTER_KEY_BYTES) {
    throw new Error(`AES-256-GCM requires a ${MASTER_KEY_BYTES}-byte key`);
  }
  const nonce = base64ToBytes(envelope.nonce);
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`AES-256-GCM requires a ${NONCE_BYTES}-byte nonce`);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
  ]);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      base64ToBytes(envelope.ct),
    );
    return new Uint8Array(pt);
  } catch {
    throw new Error("decryption failed: invalid key or tampered ciphertext");
  }
}
