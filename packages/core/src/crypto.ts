import type { Envelope } from "@zuulpass/api-types";
import { base64ToBytes, bytesToBase64, utf8ToBytes } from "./bytes.js";

// WebCrypto primitives used by the key hierarchy (docs/architecture.md §3).
export const HMAC_SHA256 = "SHA-256" as const;
export const MASTER_KEY_BYTES = 32;
export const USK_BYTES = 32;
export const NONCE_BYTES = 12;
export const GCM_TAG_BYTES = 16;

export function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

// PBKDF2-HMAC-SHA256; returns `length` bytes.
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

// HKDF-SHA256. An empty salt is expanded to HashLen zero bytes per RFC 5869
// (WebCrypto accepts `new Uint8Array(0)`).
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

// AES-256-GCM encrypt. WebCrypto appends the 16-byte tag to the ciphertext, so
// `ct` in the envelope is ciphertext||tag. `nonce` is generated unless passed
// (override is used by deterministic known-answer tests).
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

// AES-256-GCM decrypt; throws if the key is wrong or the ciphertext is tampered
// with (GCM authentication failure).
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
