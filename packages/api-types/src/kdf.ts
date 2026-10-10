import { z } from "zod";

// Versioned KDF parameters. `kdf` is an enum so Argon2id can be added later
// without breaking old accounts (see docs/architecture.md §3).
export const kdfKindSchema = z.enum(["pbkdf2"]);

export const kdfParamsSchema = z.object({
  kdf: kdfKindSchema,
  // Represents bytes on the wire; base64-encoded.
  salt: z.string().base64(),
  // PBKDF2-HMAC-SHA256 iteration count (MVP default 600_000).
  iterations: z.number().int().positive(),
  // Bump when algorithm/params change; client keeps old params for migration.
  version: z.number().int().nonnegative(),
});

export const paramsResponseSchema = z.object({
  kdf: kdfParamsSchema,
  // Per-user salt for the recovery-derived wrap key; base64 bytes.
  recoverySalt: z.string().base64(),
});

export type KdfKind = z.infer<typeof kdfKindSchema>;
export type KdfParams = z.infer<typeof kdfParamsSchema>;
export type ParamsResponse = z.infer<typeof paramsResponseSchema>;