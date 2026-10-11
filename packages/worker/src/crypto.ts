// Server-side crypto helpers. Deliberately cheap (SHA-256/HMAC only) so the
// Worker stays I/O-bound and within the 10 ms CPU budget (docs/architecture.md §12).

const encoder = new TextEncoder();

export function utf8(s: string): Uint8Array {
  return encoder.encode(s);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Opaque session token (base64 of 32 random bytes -> 44 chars).
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToBase64(buf);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacKey(pepper: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

// auth_verifier / recovery_verifier = base64(HMAC-SHA256(pepper, proofBytes)).
export async function computeVerifier(
  pepper: string,
  proofBase64: string,
): Promise<string> {
  const key = await hmacKey(pepper);
  const sig = await crypto.subtle.sign("HMAC", key, base64ToBytes(proofBase64));
  return bytesToBase64(new Uint8Array(sig));
}

async function hmac16(pepper: string, message: string): Promise<string> {
  const key = await hmacKey(pepper);
  const sig = await crypto.subtle.sign("HMAC", key, utf8(message));
  // Truncate to 16 bytes so decoy salts match the length of real per-user salts.
  return bytesToBase64(new Uint8Array(sig).subarray(0, 16));
}

// Deterministic decoy salt for unknown emails on /params, so the response is
// indistinguishable from a real one and enumeration by timing/size fails
// (docs/architecture.md §4).
export function decoySalt(
  pepper: string,
  email: string,
  kind: "salt" | "recovery",
): Promise<string> {
  return hmac16(pepper, `decoy:${kind}:${email}`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
