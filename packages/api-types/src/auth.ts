import { z } from "zod";

/** Auth Hash (and the recovery auth proof) are 32 raw bytes, base64 on the wire. */
const proofSchema = z.string().base64();

/** Opaque session token; the server stores only its SHA-256 hash. */
export const sessionTokenSchema = z.string().min(32).max(256);

export const loginRequestSchema = z.object({
  email: z.string().email(),
  authHash: proofSchema,
});

/**
 * Login is a small state machine: extend with an "mfa_required" state later
 * without breaking existing clients (docs/architecture.md §4).
 */
export const loginOkSchema = z.object({
  status: z.literal("ok"),
  token: sessionTokenSchema,
  expiresAt: z.number().int(),
});

export const loginMfaRequiredSchema = z.object({
  status: z.literal("mfa_required"),
  challenge: z.string(),
});

export const loginResponseSchema = z.discriminatedUnion("status", [
  loginOkSchema,
  loginMfaRequiredSchema,
]);

/** Base64 auth proof derived from the master key (sent to `/login`). */
export type AuthProof = z.infer<typeof loginRequestSchema>["authHash"];

/** Opaque session token string. */
export type SessionToken = z.infer<typeof sessionTokenSchema>;

/** Request body of `POST /login`. */
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Successful (`status: "ok"`) login response variant. */
export type LoginOk = z.infer<typeof loginOkSchema>;

/** Discriminated login response (`ok` | `mfa_required`). */
export type LoginResponse = z.infer<typeof loginResponseSchema>;
