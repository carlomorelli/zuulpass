import type { Envelope, KdfParams } from "@zuulpass/api-types";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  hkdf,
  randomBytes,
  USK_BYTES,
} from "./crypto.js";
import { deriveMasterKey } from "./kdf.js";

// Master Key -> HKDF(info="auth")    = Auth Hash (sent to /login)
//             -> HKDF(info="encrypt")= Stretched Key (never leaves device)
export const HKDF_INFO_AUTH = "auth";
export const HKDF_INFO_ENCRYPT = "encrypt";

export interface DerivedKeys {
  masterKey: Uint8Array;
  authHash: Uint8Array;
  stretchedKey: Uint8Array;
}

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

export function generateUSK(): Uint8Array {
  return randomBytes(USK_BYTES);
}

// Wrap the USK under the Stretched Key for server-side storage.
export async function wrapUSK(
  usk: Uint8Array,
  stretchedKey: Uint8Array,
): Promise<Envelope> {
  return aesGcmEncrypt(stretchedKey, usk);
}

export async function unwrapUSK(
  protectedUsk: Envelope,
  stretchedKey: Uint8Array,
): Promise<Uint8Array> {
  return aesGcmDecrypt(stretchedKey, protectedUsk);
}
