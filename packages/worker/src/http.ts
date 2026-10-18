import type { ErrorResponse } from "@zuulpass/api-types";

/**
 * Build the uniform error body used by all non-2xx responses
 * (docs/architecture.md §6).
 * @param code - The machine-readable error code.
 * @param message - The human-readable error message.
 * @returns The error response body.
 */
export function errorBody(
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse {
  return { error: { code, message } };
}

/**
 * Normalize an email for storage and lookup (trim + lowercase).
 * @param email - The raw email.
 * @returns The normalized email.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Minimal request shape needed to read a JSON body (structurally a Hono
 * `Context`).
 */
export interface JsonRequest {
  req: { json: () => Promise<unknown> };
}

/**
 * Read a JSON request body, treating a missing or malformed body as `undefined`
 * so route handlers can reject it with a 400 instead of throwing.
 * @param c - The request-carrying context.
 * @returns The parsed body, or `undefined` if absent or not valid JSON.
 */
export async function readJson(c: JsonRequest): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
