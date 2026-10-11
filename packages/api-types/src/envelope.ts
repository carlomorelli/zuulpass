import { z } from "zod";

/**
 * AES-256-GCM ciphertext envelope (docs/architecture.md §3). Bytes are base64
 * on the wire; the worker treats the envelope as opaque.
 */
export const envelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal("AES-256-GCM"),
  nonce: z.string().base64(),
  ct: z.string().base64(),
});

/**
 * Validated AES-256-GCM envelope: version, algorithm, nonce, and
 * ciphertext||tag.
 */
export type Envelope = z.infer<typeof envelopeSchema>;
