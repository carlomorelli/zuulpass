import { z } from "zod";
import { envelopeSchema } from "./envelope.js";
import { kdfParamsSchema } from "./kdf.js";

// POST /account/register — the client sends all key material. The worker
// derives verifiers server-side (HMAC(pepper, proof)) and stores them.
export const registerRequestSchema = z.object({
  email: z.string().email(),
  kdf: kdfParamsSchema,
  protectedUsk: envelopeSchema,
  recoveryProtectedUsk: envelopeSchema,
  recoverySalt: z.string().base64(),
  authHash: z.string().base64(),
  recoveryAuth: z.string().base64(),
});

// POST /account/change-master-password — wraps the same USK under a new
// master password; vault items are never re-encrypted.
export const changeMasterPasswordRequestSchema = z.object({
  newKdf: kdfParamsSchema,
  newProtectedUsk: envelopeSchema,
  newAuthHash: z.string().base64(),
});

// POST /account/recover — authorized by the recovery auth proof instead of the
// master password; then sets a new master password.
export const recoverRequestSchema = z.object({
  recoveryAuth: z.string().base64(),
  newKdf: kdfParamsSchema,
  newProtectedUsk: envelopeSchema,
  newAuthHash: z.string().base64(),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type ChangeMasterPasswordRequest = z.infer<typeof changeMasterPasswordRequestSchema>;
export type RecoverRequest = z.infer<typeof recoverRequestSchema>;