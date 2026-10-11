import type { ErrorResponse } from "@zuulpass/api-types";

// Uniform error body for all non-2xx responses (docs/architecture.md §6).
export function errorBody(
  code: ErrorResponse["error"]["code"],
  message: string,
): ErrorResponse {
  return { error: { code, message } };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
