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
