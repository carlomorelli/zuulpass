import { Hono } from "hono";
import {
  accountKeysResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
} from "@zuulpass/api-types";
import type { Env, Variables } from "./env.js";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_SLIDING_MS,
  requireAuth,
} from "./auth.js";
import {
  computeVerifier,
  decoySalt,
  randomToken,
  sha256Hex,
  timingSafeEqual,
} from "./crypto.js";
import { errorBody, normalizeEmail, readJson } from "./http.js";
import { registerVaultRoutes } from "./vault.js";

// Decoy KDF parameters must mirror what `core.generateKdfParams()` produces.
const DEFAULT_ITERATIONS = 600_000;
const KDF_VERSION = 1;

interface UserRow {
  id: string;
  auth_verifier: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.get("/health", (c) => c.json({ ok: true, service: "zuulpass" }));

/**
 * GET /params?email= -> versioned KDF params. Decoy-safe: unknown emails get a
 * deterministic fake salt of the same shape (docs/architecture.md §4, §6).
 */
app.get("/params", async (c) => {
  const email = normalizeEmail(c.req.query("email") ?? "");
  if (!email) {
    return c.json(errorBody("invalid_request", "email query is required"), 400);
  }
  const user = await c.env.DB.prepare(
    "SELECT kdf_params, recovery_salt FROM users WHERE email = ?",
  )
    .bind(email)
    .first<{ kdf_params: string; recovery_salt: string }>();
  if (user) {
    return c.json({
      kdf: JSON.parse(user.kdf_params),
      recoverySalt: user.recovery_salt,
    });
  }
  return c.json({
    kdf: {
      kdf: "pbkdf2",
      salt: await decoySalt(c.env.PEPPER, email, "salt"),
      iterations: DEFAULT_ITERATIONS,
      version: KDF_VERSION,
    },
    recoverySalt: await decoySalt(c.env.PEPPER, email, "recovery"),
  });
});

/**
 * POST /account/register -> 201. Stores verifiers as HMAC(pepper, proof); the
 * worker never sees the master password or any unwrapped key.
 */
app.post("/account/register", async (c) => {
  const parsed = registerRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return c.json(
      errorBody("invalid_request", "invalid registration body"),
      400,
    );
  }
  const body = parsed.data;
  const email = normalizeEmail(body.email);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?",
  )
    .bind(email)
    .first();
  if (existing) {
    return c.json(errorBody("conflict", "email already registered"), 409);
  }
  const [authVerifier, recoveryVerifier] = await Promise.all([
    computeVerifier(c.env.PEPPER, body.authHash),
    computeVerifier(c.env.PEPPER, body.recoveryAuth),
  ]);
  await c.env.DB.prepare(
    `INSERT INTO users (
       id, email, created_at, kdf, kdf_salt, kdf_params, kdf_version,
       protected_usk, recovery_protected_usk, recovery_salt,
       auth_verifier, recovery_verifier
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      email,
      Date.now(),
      body.kdf.kdf,
      body.kdf.salt,
      JSON.stringify(body.kdf),
      body.kdf.version,
      JSON.stringify(body.protectedUsk),
      JSON.stringify(body.recoveryProtectedUsk),
      body.recoverySalt,
      authVerifier,
      recoveryVerifier,
    )
    .run();
  return c.body(null, 201);
});

// POST /login { email, authHash } -> { status: "ok", token, expiresAt }.
app.post("/login", async (c) => {
  const parsed = loginRequestSchema.safeParse(await readJson(c));
  if (!parsed.success) {
    return c.json(errorBody("invalid_request", "invalid login body"), 400);
  }
  const email = normalizeEmail(parsed.data.email);
  const user = await c.env.DB.prepare(
    "SELECT id, auth_verifier FROM users WHERE email = ?",
  )
    .bind(email)
    .first<UserRow>();
  const verifier = await computeVerifier(c.env.PEPPER, parsed.data.authHash);
  if (!user || !timingSafeEqual(verifier, user.auth_verifier)) {
    return c.json(errorBody("unauthorized", "invalid credentials"), 401);
  }
  const now = Date.now();
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = now + SESSION_SLIDING_MS;
  await c.env.DB.prepare(
    `INSERT INTO sessions (
       id, user_id, token_hash, kind, label,
       created_at, last_seen_at, expires_at, absolute_expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      user.id,
      tokenHash,
      "cli",
      null,
      now,
      now,
      expiresAt,
      now + SESSION_ABSOLUTE_MS,
    )
    .run();
  return c.json({ status: "ok" as const, token, expiresAt });
});

// POST /logout -> 204. Deletes the current ephemeral session.
app.post("/logout", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?")
    .bind(c.get("sessionId"))
    .run();
  return c.body(null, 204);
});

// GET /account/keys -> wrapped USK so a fresh client can unlock the local cache.
app.get("/account/keys", requireAuth, async (c) => {
  const user = await c.env.DB.prepare(
    "SELECT protected_usk FROM users WHERE id = ?",
  )
    .bind(c.get("userId"))
    .first<{ protected_usk: string }>();
  if (!user) {
    return c.json(errorBody("unauthorized", "session user not found"), 401);
  }
  return c.json(
    accountKeysResponseSchema.parse({
      protectedUsk: JSON.parse(user.protected_usk),
    }),
  );
});

registerVaultRoutes(app);

app.notFound((c) => c.json(errorBody("not_found", "not found"), 404));

app.onError((err, c) => {
  console.error("unhandled worker error", err);
  return c.json(errorBody("internal_error", "internal error"), 500);
});

export default app;
