import type { Envelope, KdfParams } from "@zuulpass/api-types";
import { bytesToBase64 } from "./bytes.js";
import {
  createApiClient,
  getAccountKeys,
  getParams,
  login,
  type ApiClient,
} from "./client.js";
import { deriveKeys, unwrapUSK } from "./keys.js";

/**
 * The hidden preamble every authenticated command runs (docs/architecture.md
 * §9, §15.2): fetch params -> derive keys -> login (ephemeral token) -> fetch
 * the wrapped USK -> unwrap it locally. The master password and USK never leave
 * the process.
 */
export interface UnlockOptions {
  serverUrl: string;
  email: string;
  masterPassword: string;
  fetch?: typeof fetch;
}

/** Result of a successful unlock: ephemeral token plus the unwrapped USK. */
export interface UnlockedSession {
  token: string;
  usk: Uint8Array;
  expiresAt: number;
  kdf: KdfParams;
  recoverySalt: string;
  protectedUsk: Envelope;
}

/**
 * Fetch KDF params, derive keys, log in, and unwrap the USK.
 * @param options - Server URL, account email, and master password.
 * @returns The ephemeral session token and unwrapped USK plus KDF metadata.
 * @throws If the server rejects the login or the wrapped USK cannot be unwrapped.
 */
export async function unlock(options: UnlockOptions): Promise<UnlockedSession> {
  const client: ApiClient = createApiClient(
    options.serverUrl,
    options.fetch ?? fetch,
  );
  const params = await getParams(client, options.email);
  const { authHash, stretchedKey } = await deriveKeys(
    options.masterPassword,
    params.kdf,
  );
  const result = await login(client, {
    email: options.email,
    authHash: bytesToBase64(authHash),
  });
  if (result.status !== "ok") {
    throw new Error("multi-factor login is not supported yet");
  }
  const keys = await getAccountKeys(client, result.token);
  const usk = await unwrapUSK(keys.protectedUsk, stretchedKey);
  return {
    token: result.token,
    usk,
    expiresAt: result.expiresAt,
    kdf: params.kdf,
    recoverySalt: params.recoverySalt,
    protectedUsk: keys.protectedUsk,
  };
}
