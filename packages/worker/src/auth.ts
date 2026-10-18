import { createMiddleware } from "hono/factory";
import type { Env, Variables } from "./env.js";
import { sha256Hex } from "./crypto.js";
import { errorBody } from "./http.js";

/** Sliding expiry with an absolute cap (docs/architecture.md §4). */
export const SESSION_SLIDING_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

/** Subset of a session row needed for auth checks. */
interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  absolute_expires_at: number;
}

/**
 * Hash a bearer token from an `Authorization` header. The server stores only
 * SHA-256(token); the raw token never touches the DB.
 * @param header - The raw `Authorization` header value, if any.
 * @returns The hex SHA-256 of the token, or `null` if malformed or absent.
 */
export async function tokenHashFromHeader(
  header: string | undefined,
): Promise<string | null> {
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }
  return sha256Hex(token);
}

/**
 * Hono middleware that resolves and validates the session token, sliding its
 * expiry forward, and exposes `userId`/`sessionId` on the context.
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: Variables;
}>(async (c, next) => {
  const tokenHash = await tokenHashFromHeader(c.req.header("authorization"));
  if (!tokenHash) {
    return c.json(errorBody("unauthorized", "missing or malformed token"), 401);
  }
  const row = await c.env.DB.prepare(
    "SELECT id, user_id, expires_at, absolute_expires_at FROM sessions WHERE token_hash = ?",
  )
    .bind(tokenHash)
    .first<SessionRow>();
  const now = Date.now();
  if (!row || now >= row.expires_at || now >= row.absolute_expires_at) {
    return c.json(errorBody("unauthorized", "session expired or invalid"), 401);
  }
  const expiresAt = Math.min(now + SESSION_SLIDING_MS, row.absolute_expires_at);
  await c.env.DB.prepare(
    "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?",
  )
    .bind(now, expiresAt, row.id)
    .run();
  c.set("userId", row.user_id);
  c.set("sessionId", row.id);
  await next();
});
