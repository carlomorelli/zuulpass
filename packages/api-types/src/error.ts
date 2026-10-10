import { z } from "zod";

// Uniform error body for all non-2xx responses.
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "unauthorized",
      "not_found",
      "conflict",
      "rate_limited",
      "internal_error",
    ]),
    message: z.string(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
