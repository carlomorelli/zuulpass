/** Byte <-> string helpers that run in both Node.js and Workers. */
export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

/**
 * Encode a UTF-8 string to bytes.
 * @param s - The string to encode.
 * @returns The UTF-8 encoded bytes.
 */
export function utf8ToBytes(s: string): Uint8Array {
  return textEncoder.encode(s);
}

/**
 * Decode UTF-8 bytes to a string.
 * @param bytes - The UTF-8 bytes to decode.
 * @returns The decoded string.
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/**
 * Base64-encode bytes in chunks to avoid call-stack limits on large input.
 * @param bytes - The bytes to encode.
 * @returns The base64-encoded string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decode a base64 string to bytes.
 * @param b64 - The base64 string to decode.
 * @returns The decoded bytes.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
