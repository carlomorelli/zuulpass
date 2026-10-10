import { z } from "zod";

// A vault item as stored/served by the worker. Only routing/versioning metadata
// is plaintext; the payload itself is opaque ciphertext (base64).
export const vaultItemSchema = z.object({
  id: z.string().min(1).max(64),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int(),
  deleted: z.boolean().default(false),
  ciphertext: z.string().base64(),
});

// Opaque cursor: the server timestamp to resume incremental sync from.
export const syncCursorSchema = z.number().int();

export const vaultPullResponseSchema = z.object({
  items: z.array(vaultItemSchema),
  cursor: syncCursorSchema,
});

// Clients send the last revision they saw; the server bumps `revision` and
// applies last-write-wins (docs/architecture.md §7).
export const vaultPutRequestSchema = z.object({
  id: z.string().min(1).max(64),
  baseRevision: z.number().int().nonnegative(),
  ciphertext: z.string().base64(),
});

export const vaultDeleteRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
});

// Result of a successful write.
export const vaultWriteResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int(),
});

export type VaultItem = z.infer<typeof vaultItemSchema>;
export type VaultPullResponse = z.infer<typeof vaultPullResponseSchema>;
export type VaultPutRequest = z.infer<typeof vaultPutRequestSchema>;
export type VaultDeleteRequest = z.infer<typeof vaultDeleteRequestSchema>;
export type VaultWriteResponse = z.infer<typeof vaultWriteResponseSchema>;
