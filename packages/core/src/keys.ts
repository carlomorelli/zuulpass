import type { Envelope, KdfParams } from "@zuulpass/api-types";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  hkdf,
  randomBytes,
  USK_BYTES,
} from "./crypto.js";
import { deriveMasterKey } from "./kdf.js";

/**
 * Master Key -> HKDF(info="auth")    = Auth Hash (sent to /login)
 *             -> HKDF(info="encrypt")= Stretched Key (never leaves device)
 */
export const HKDF_INFO_AUTH = "auth";
export const HKDF_INFO_ENCRYPT = "encrypt";

/** The three subkeys derived from the master password. */
export interface DerivedKeys {
  /** PBKDF2 master key. */
  masterKey: Uint8Array;
  /** HKDF(info="auth") hash sent to the server. */
  authHash: Uint8Array;
  /** HKDF(info="encrypt") key that wraps the USK; never leaves the device. */
  stretchedKey: Uint8Array;
}

/**
 * Derive the auth hash and stretched key from the master password.
 * @param masterPassword - The user's master password.
 * @param kdf - The account's versioned KDF parameters.
 * @returns The master key, auth hash, and stretched key.
 */
export async function deriveKeys(
  masterPassword: string,
  kdf: KdfParams,
): Promise<DerivedKeys> {
  const masterKey = await deriveMasterKey(masterPassword, kdf);
  const emptySalt = new Uint8Array(0);
  const [authHash, stretchedKey] = await Promise.all([
    hkdf(masterKey, emptySalt, HKDF_INFO_AUTH),
    hkdf(masterKey, emptySalt, HKDF_INFO_ENCRYPT),
  ]);
  return { masterKey, authHash, stretchedKey };
}

/**
 * Generate a fresh random User Symmetric Key (USK).
 * @returns A new 32-byte USK.
 */
export function generateUSK(): Uint8Array {
  return randomBytes(USK_BYTES);
}

/**
 * Wrap the USK under the Stretched Key for server-side storage.
 * @param usk - The User Symmetric Key to wrap.
 * @param stretchedKey - The wrapping key derived from the master password.
 * @returns The wrapped USK envelope.
 */
export async function wrapUSK(
  usk: Uint8Array,
  stretchedKey: Uint8Array,
): Promise<Envelope> {
  return aesGcmEncrypt(stretchedKey, usk);
}

/**
 * Unwrap the server-stored USK with the Stretched Key.
 * @param protectedUsk - The wrapped USK envelope.
 * @param stretchedKey - The wrapping key derived from the master password.
 * @returns The unwrapped USK bytes.
 * @throws If the Stretched Key is wrong or the envelope is tampered with.
 */
export async function unwrapUSK(
  protectedUsk: Envelope,
  stretchedKey: Uint8Array,
): Promise<Uint8Array> {
  return aesGcmDecrypt(stretchedKey, protectedUsk);
}
