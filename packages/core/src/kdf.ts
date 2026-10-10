import type { KdfParams } from "@zuulpass/api-types";
import { base64ToBytes, bytesToBase64 } from "./bytes.js";
import { pbkdf2, randomBytes } from "./crypto.js";

// MVP KDF parameters (docs/architecture.md §3). Versioned so Argon2id can be
// added later without breaking existing accounts.
export const DEFAULT_KDF_ITERATIONS = 600_000;
export const KDF_VERSION = 1;
export const KDF_SALT_BYTES = 16;

export function generateKdfParams(): KdfParams {
  return {
    kdf: "pbkdf2",
    salt: bytesToBase64(randomBytes(KDF_SALT_BYTES)),
    iterations: DEFAULT_KDF_ITERATIONS,
    version: KDF_VERSION,
  };
}

// Master Key = PBKDF2-HMAC-SHA256(masterPassword, salt, iterations).
export async function deriveMasterKey(
  masterPassword: string,
  kdf: KdfParams,
): Promise<Uint8Array> {
  if (kdf.kdf !== "pbkdf2") {
    throw new Error(`unsupported KDF: ${kdf.kdf}`);
  }
  const salt = base64ToBytes(kdf.salt);
  return pbkdf2(masterPassword, salt, kdf.iterations);
}
