import { z } from "zod";
import { envelopeSchema } from "./envelope.js";
import { kdfParamsSchema } from "./kdf.js";

/**
 * Request body of `POST /account/register` — the client sends all key material.
 * The worker derives verifiers server-side (HMAC(pepper, proof)) and stores them.
 */
export const registerRequestSchema = z.object({
  email: z.string().email(),
  kdf: kdfParamsSchema,
  protectedUsk: envelopeSchema,
  recoveryProtectedUsk: envelopeSchema,
  recoverySalt: z.string().base64(),
  authHash: z.string().base64(),
  recoveryAuth: z.string().base64(),
});

/**
 * Response body of `GET /account/keys` — authenticated; returns the wrapped USK
 * so a fresh client can unwrap it locally with the password-derived Stretched Key.
 */
export const accountKeysResponseSchema = z.object({
  protectedUsk: envelopeSchema,
});

/**
 * Request body of `POST /account/change-master-password` — wraps the same USK
 * under a new master password; vault items are never re-encrypted.
 */
export const changeMasterPasswordRequestSchema = z.object({
  newKdf: kdfParamsSchema,
  newProtectedUsk: envelopeSchema,
  newAuthHash: z.string().base64(),
});

/**
 * Request body of `POST /account/recover` — authorized by the recovery auth
 * proof instead of the master password; then sets a new master password.
 */
export const recoverRequestSchema = z.object({
  recoveryAuth: z.string().base64(),
  newKdf: kdfParamsSchema,
  newProtectedUsk: envelopeSchema,
  newAuthHash: z.string().base64(),
});

/** Request body of `POST /account/register`. */
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Response body of `GET /account/keys`. */
export type AccountKeysResponse = z.infer<typeof accountKeysResponseSchema>;

/** Request body of `POST /account/change-master-password`. */
export type ChangeMasterPasswordRequest = z.infer<
  typeof changeMasterPasswordRequestSchema
>;

/** Request body of `POST /account/recover`. */
export type RecoverRequest = z.infer<typeof recoverRequestSchema>;
