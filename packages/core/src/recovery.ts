import type { Envelope } from "@zuulpass/api-types";
import { base32nopad } from "@scure/base";
import { aesGcmDecrypt, aesGcmEncrypt, hkdf, randomBytes } from "./crypto.js";

/**
 * Recovery key (docs/architecture.md §3): 256-bit random, shown to the user
 * once as a base32 code; lets the USK be unwrapped without the master password.
 */
export const RECOVERY_KEY_BYTES = 32;
export const RECOVERY_SALT_BYTES = 16;

export const HKDF_INFO_RECOVERY = "recovery";
export const HKDF_INFO_RECOVERY_AUTH = "recovery-auth";

const GROUP_SIZE = 4;

/**
 * Encode recovery bytes as a grouped, uppercase base32 code.
 * @param bytes - The recovery key bytes to encode.
 * @returns The recovery code (e.g. `ABCD-EFGH-...`).
 */
export function encodeRecoveryCode(bytes: Uint8Array): string {
  const encoded = base32nopad.encode(bytes).toUpperCase();
  const groups = encoded.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g"));
  return (groups ?? []).join("-");
}

/**
 * Decode a recovery code to bytes, ignoring whitespace and dashes.
 * @param code - The user-supplied recovery code.
 * @returns The decoded recovery key bytes.
 * @throws If the code contains non-base32 characters.
 */
export function decodeRecoveryCode(code: string): Uint8Array {
  const normalized = code.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("invalid recovery code: not base32");
  }
  return base32nopad.decode(normalized);
}

/**
 * Generate a new random recovery key and its display code.
 * @returns The recovery key bytes and its base32 code.
 */
export function generateRecoveryKey(): {
  recoveryKey: Uint8Array;
  recoveryCode: string;
} {
  const recoveryKey = randomBytes(RECOVERY_KEY_BYTES);
  return { recoveryKey, recoveryCode: encodeRecoveryCode(recoveryKey) };
}

/**
 * Generate a fresh random recovery salt.
 * @returns A new recovery salt.
 */
export function generateRecoverySalt(): Uint8Array {
  return randomBytes(RECOVERY_SALT_BYTES);
}

/**
 * Derive the recovery wrap key = HKDF(recoveryKey, salt=recoverySalt,
 * info="recovery").
 * @param recoveryKey - The recovery key bytes.
 * @param recoverySalt - The account's recovery salt.
 * @returns The recovery wrap key.
 */
export async function deriveRecoveryWrapKey(
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  return hkdf(recoveryKey, recoverySalt, HKDF_INFO_RECOVERY);
}

/**
 * Derive the recovery auth proof = HKDF(recoveryWrapKey, info="recovery-auth"),
 * proving knowledge of the recovery key to the server without revealing it.
 * @param recoveryKey - The recovery key bytes.
 * @param recoverySalt - The account's recovery salt.
 * @returns The recovery auth proof bytes.
 */
export async function deriveRecoveryAuth(
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return hkdf(wrapKey, new Uint8Array(0), HKDF_INFO_RECOVERY_AUTH);
}

/**
 * Wrap the USK with the recovery wrap key for server-side storage.
 * @param usk - The User Symmetric Key to wrap.
 * @param recoveryKey - The recovery key bytes.
 * @param recoverySalt - The account's recovery salt.
 * @returns The recovery-wrapped USK envelope.
 */
export async function wrapUSKWithRecovery(
  usk: Uint8Array,
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Envelope> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return aesGcmEncrypt(wrapKey, usk);
}

/**
 * Unwrap the recovery-protected USK.
 * @param recoveryProtectedUsk - The recovery-wrapped USK envelope.
 * @param recoveryKey - The recovery key bytes.
 * @param recoverySalt - The account's recovery salt.
 * @returns The unwrapped USK bytes.
 * @throws If the recovery key is wrong or the envelope is tampered with.
 */
export async function unwrapUSKWithRecovery(
  recoveryProtectedUsk: Envelope,
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return aesGcmDecrypt(wrapKey, recoveryProtectedUsk);
}
