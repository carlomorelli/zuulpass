import { z } from "zod";

// Auth Hash (and the recovery auth proof) are 32 raw bytes, base64 on the wire.
const proofSchema = z.string().base64();

// Opaque session token. The server stores only SHA-256(token).
export const sessionTokenSchema = z.string().min(32).max(256);

export const loginRequestSchema = z.object({
  email: z.string().email(),
  authHash: proofSchema,
});

// Login is a small state machine: extend with a "mfa_required" state later
// without breaking existing clients (docs/architecture.md §4).
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

export type AuthProof = z.infer<typeof loginRequestSchema>["authHash"];
export type SessionToken = z.infer<typeof sessionTokenSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginOk = z.infer<typeof loginOkSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
