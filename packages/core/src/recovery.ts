import type { Envelope } from "@zuulpass/api-types";
import { base32nopad } from "@scure/base";
import { aesGcmDecrypt, aesGcmEncrypt, hkdf, randomBytes } from "./crypto.js";

// Recovery key (docs/architecture.md §3): 256-bit random, shown to the user
// once as a base32 code; lets the USK be unwrapped without the master password.
export const RECOVERY_KEY_BYTES = 32;
export const RECOVERY_SALT_BYTES = 16;

export const HKDF_INFO_RECOVERY = "recovery";
export const HKDF_INFO_RECOVERY_AUTH = "recovery-auth";

const GROUP_SIZE = 4;

export function encodeRecoveryCode(bytes: Uint8Array): string {
  const encoded = base32nopad.encode(bytes).toUpperCase();
  const groups = encoded.match(new RegExp(`.{1,${GROUP_SIZE}}`, "g"));
  return (groups ?? []).join("-");
}

export function decodeRecoveryCode(code: string): Uint8Array {
  const normalized = code.replace(/[\s-]+/g, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("invalid recovery code: not base32");
  }
  return base32nopad.decode(normalized);
}

export function generateRecoveryKey(): {
  recoveryKey: Uint8Array;
  recoveryCode: string;
} {
  const recoveryKey = randomBytes(RECOVERY_KEY_BYTES);
  return { recoveryKey, recoveryCode: encodeRecoveryCode(recoveryKey) };
}

export function generateRecoverySalt(): Uint8Array {
  return randomBytes(RECOVERY_SALT_BYTES);
}

// Recovery wrap key = HKDF(recoveryKey, salt=recoverySalt, info="recovery").
export async function deriveRecoveryWrapKey(
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  return hkdf(recoveryKey, recoverySalt, HKDF_INFO_RECOVERY);
}

// Recovery Auth Proof = HKDF(recoveryWrapKey, info="recovery-auth") — proves
// knowledge of the recovery key to the server without revealing it.
export async function deriveRecoveryAuth(
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return hkdf(wrapKey, new Uint8Array(0), HKDF_INFO_RECOVERY_AUTH);
}

export async function wrapUSKWithRecovery(
  usk: Uint8Array,
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Envelope> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return aesGcmEncrypt(wrapKey, usk);
}

export async function unwrapUSKWithRecovery(
  recoveryProtectedUsk: Envelope,
  recoveryKey: Uint8Array,
  recoverySalt: Uint8Array,
): Promise<Uint8Array> {
  const wrapKey = await deriveRecoveryWrapKey(recoveryKey, recoverySalt);
  return aesGcmDecrypt(wrapKey, recoveryProtectedUsk);
}
