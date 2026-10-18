# ZuulPass — Project Status

> Handoff note. Update this file at every checkpoint: mark completed work,
> note current phase, and record any gotchas or open decisions for the next
> session. A fresh session should read this file **before** reading code.

## Project

A zero-knowledge password manager. Cloudflare Worker backend (D1 storage) +
Node CLI client. Full design: [`docs/architecture.md`](docs/architecture.md).

## MVP build order (per `docs/architecture.md` §11)

| #   | Phase                                                                                                          | Status      |
| --- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Scaffold monorepo (pnpm, base tsconfig, vitest)                                                                | **done**    |
| 2   | `api-types`: Zod schemas for endpoints + payloads                                                              | **done**    |
| 3   | `core` crypto: PBKDF2/HKDF/AES-GCM envelope, key hierarchy, recovery (+ test vectors)                          | **done**    |
| 4   | `core`: config, local encrypted cache, sync engine, headless `VaultService`                                    | **partial** |
| 5   | `worker`: Hono routes, D1 schema + migrations, auth/sessions, vault CRUD, sync                                 | **partial** |
| 6   | `cli`: `init`, unlock/sync preamble, `get`/`ls`, `add`/`edit`/`rm`, `gen`, `change-master-password`, `recover` | **partial** |
| 7   | Integration tests (CLI <-> local Worker) + CI                                                                  | **partial** |

## Current phase

Phase 5 (worker vault slice) — **server-side done**. The plan's 4/5 order was
deliberately flipped: the vault routes were built first so the sync engine can be
developed against a real, runnable target (see "Ordering decision" below).

Shipped in this slice: migration `0002_vault.sql` (`vault_items`) plus
`GET /vault?since=`, `POST /vault/items`, `DELETE /vault/items/:id` (LWW upserts,
tombstones, incremental cursor) behind `requireAuth`. Hand-verified end-to-end
against `wrangler dev` + local D1 (register → login → insert → LWW bump →
tombstone → pull → 401).

**Next:** phase 4 — `core` sync engine: `sync.json` cursor, vault API client
methods (`vault.ts` schemas already exist), `LocalVaultItem` sync metadata
(revision/updatedAt/deleted), pull-merge-LWW, write-through, offline read
fallback, and the headless `VaultService`. Then phase 6 CLI commands.

## Completed so far

- `docs/architecture.md` — full design document (crypto, key hierarchy, D1 schema, API, CLI, sync, Mermaid diagrams).
- Git repo initialized; first commit `868e8c3 "Design document"`.
- **Phase 1 done:** pnpm workspace scaffolded (`pnpm` 12.11.2, Node 24). Root configs: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`.
- Packages created: `@zuulpass/core`, `@zuulpass/api-types` (zod dep), `@zuulpass/worker` (wrangler + workers-types dev deps), `@zuulpass/cli`.
- `pnpm typecheck` passes (all 4 packages); `pnpm test` passes (1 smoke test); `pnpm --filter @zuulpass/cli start` runs via tsx.
- **Phase 2 done:** `api-types` wire contract implemented and tested (18 tests):
  - `kdf.ts` (versioned KDF params + `/params` response), `auth.ts` (login state machine), `envelope.ts` (AES-256-GCM envelope), `account.ts` (register / change-master-password / recover), `vault.ts` (item, pull, put, delete, cursor), `error.ts` (uniform error body).
  - All parsed/inferred types re-exported from `src/index.ts`.
- **Phase 3 done:** `core` crypto implemented and tested (51 tests total across the repo, 33 new):
  - `bytes.ts` — env-agnostic UTF-8 + base64 (`TextEncoder`/`btoa`/`atob`; chunked to avoid stack limits).
  - `crypto.ts` — WebCrypto `randomBytes`, `pbkdf2` (PBKDF2-HMAC-SHA256), `hkdf` (SHA-256; `info` accepts `string | Uint8Array`), `aesGcmEncrypt`/`aesGcmDecrypt` returning/consuming the `Envelope` shape (`ct` = ciphertext||tag). Constants: 32-byte keys, 12-byte nonce, 16-byte GCM tag.
  - `kdf.ts` — `generateKdfParams()` (pbkdf2, 16-byte salt, 600_000 iters, version 1), `deriveMasterKey()`.
  - `keys.ts` — `deriveKeys()` → `{masterKey, authHash, stretchedKey}` (HKDF info `"auth"` / `"encrypt"`, empty salt), `generateUSK()`, `wrapUSK`/`unwrapUSK`.
  - `recovery.ts` — recovery key (32B) + base32 code (grouped uppercase), `deriveRecoveryWrapKey` (HKDF info `"recovery"`, salt = recovery_salt), `deriveRecoveryAuth` (HKDF info `"recovery-auth"` over the wrap key), `wrapUSKWithRecovery`/`unwrapUSKWithRecovery`.
  - Tests validate: PBKDF2 known-answer + node:crypto cross-check, RFC 5869 HKDF cases 1 & 4, AES-GCM known cross-check vs node `createCipheriv` + tamper/wrong-key/nonce guards, full key hierarchy + 600k production flow, recovery code round-trips + full recovery flow, and every produced envelope against `envelopeSchema`.
  - `core` deps: `@zuulpass/api-types` (`workspace:*`, type-only usage), `@scure/base` (base32). Test-only helpers in `packages/core/test/crypto-helpers.ts`.
- **Login-session slice done (77 tests total; manual smoke-verified):**
  - `api-types`: `loginRequestSchema` now requires `email` (was authHash-only — server could not route logins); added `accountKeysResponseSchema` for `GET /account/keys`.
  - `worker`: Hono app (`hono` dep), `wrangler.toml` + D1 migration `0001_init.sql` (`users`, `sessions`), routes `GET /health`, `GET /params` (decoy-safe), `POST /account/register`, `POST /login`, `POST /logout`, `GET /account/keys`; SHA-256 token at rest + sliding/absolute session expiry; auth verifier = `HMAC-SHA256(PEPPER, authHash)`.
  - `core`: `config.ts` (ZUULPASS_HOME; default `%APPDATA%\zuulpass` on Windows; `config.json` / `params.json`), `client.ts` (typed fetch API incl. `ApiError`), `cache.ts` (`cache.enc` AES-GCM under USK), `session.ts` (`unlock` preamble), `vault-item.ts` (decrypted payload model), `password-policy.ts` (zxcvbn >= 3 floor). New deps: `@zxcvbn-ts/{core,language-common,language-en}`.
  - `cli`: commander + `@inquirer/prompts`; `zuulp init` (register + recovery code), `zuulp add`, `zuulp ls`; items stored locally, login/session real.
  - Verified by hand: `zuulp init` -> register, recovery code printed; `zuulp add` -> login preamble + cache write; `zuulp ls` -> decrypts cache; D1 shows the row.
- **JSDoc standard enforced across all packages:** added the "Comments & documentation" section to `AGENTS.md` (JSDoc `/** ... */` for multi-line comments; document every public/exported class, interface, type, method, and function; `@param`/`@returns`/`@throws`). Added `eslint-plugin-jsdoc` (^65.3.0) configured in `eslint.config.ts` (`jsdoc/require-jsdoc` with `publicOnly` + TS contexts, plus `require-param(-description)`, `require-returns(-description)`, `require-throws`). Documented all public exports across `api-types`, `core`, and `worker` and converted multi-line `//` prose to JSDoc. All gates green: lint / typecheck / test (77) / format. (Committed in `3d82e35`.)
- **CI + deployment workflows wired (`.github/workflows/`):**
  - `ci.yml` — on every push (all branches) / PR / manual: checkout → pnpm (`packageManager`) → Node 24 with pnpm cache → `pnpm install --frozen-lockfile` → lint → prettier `--check` → typecheck → test → `wrangler deploy --dry-run --env dev` (bundle/config sanity, no auth).
  - `deploy.yml` — on push to `main` / manual: `verify` → `deploy-dev` → `deploy-prod`. Each deploy job declares its GitHub environment (`dev` / `prod`, which selects the `PEPPER` secret) and applies D1 migrations (`wrangler d1 migrations apply zuulpass-<env> --remote --env <env>`), then deploys (`wrangler deploy --env <env>`), then sets the worker secret (`printf '%s' "$PEPPER" | wrangler secret put PEPPER --env <env>`). Cloudflare auth via repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; `WRANGLER_SEND_METRICS=false`; deploy concurrency does not cancel in progress.
  - `wrangler.toml` split into `[env.dev]` / `[env.prod]` with their own D1 bindings; worker names default to `zuulpass-dev` / `zuulpass-prod` (no explicit `name`). Both envs verified with `wrangler deploy --dry-run`. Both workflow files validated as YAML.
- **Phase 5 vault slice done (89 tests total):**
  - `worker`: migration `0002_vault.sql` — `vault_items(id, user_id, revision, updated_at, deleted, ciphertext)` with `PRIMARY KEY (user_id, id)` + index `idx_vault_items_user_updated(user_id, updated_at)`.
  - `worker/src/vault.ts`: `registerVaultRoutes(app)` wires `GET /vault?since=`, `POST /vault/items`, `DELETE /vault/items/:id` (all behind `requireAuth`). LWW upsert accepts a stale `baseRevision` and always bumps `revision`; writing over a tombstone resurrects the item; delete is an idempotent tombstone (no-op for an absent/already-deleted row); pull returns items with `updated_at > since`, oldest first, `LIMIT PULL_PAGE_SIZE` (500), cursor = last item's `updated_at`.
  - Per-user `updated_at` is **strictly increasing**: each write takes `max(Date.now(), MAX(updated_at for user) + 1)`, which makes the `>` cursor tie-free (see gotchas).
  - `worker/src/http.ts`: `readJson` moved here (shared with `index.ts`); added exported `JsonRequest` type.
  - Tests: `worker/src/vault.test.ts` (12) with a small in-memory fake D1 — auth/401, `since` validation, insert/LWW bump/resurrect, per-user scoping, tombstone + idempotency, absent-item delete, cursor advance/exclusion.
  - Hand-verified E2E against `wrangler dev --env dev` + local D1: register → login → insert (rev 1) → stale-base put (rev 2, ciphertext replaced) → delete (rev 3 tombstone) → pull (`deleted: true`) → 401 without token.
  - **Reusable black-box smoke test:** `packages/integration-tests/smoke-vault.test.ts` (Vitest, plain `fetch`, no workspace imports) runs 16 checks against a _running_ worker — health, register/conflict, wrong-password 401, login, vault 401/400, insert, pull+cursor, LWW bump, incremental pull, tombstone, idempotent delete, per-user isolation, invalid body. Run with `pnpm integration-test` (default `http://127.0.0.1:8787`) or `pnpm integration-test -- --server <url>` / `ZUULPASS_SMOKE_URL`. Verified 16/16 green against the local dev worker.
  - The integration suite lives in the `@zuulpass/integration-tests` workspace package and is **excluded from the root `pnpm test`** (`vitest.config.ts` `exclude`), so unit tests stay hermetic. Its `tsconfig.json` is part of the root `pnpm typecheck`. `pnpm integration-test` delegates to the package's `vitest run`.

## Key conventions / locked decisions (short version)

- Zero-knowledge; PBKDF2-HMAC-SHA256 @ 600k (Argon2id migration path kept).
- AES-256-GCM via WebCrypto; HKDF-SHA256 subkeys; versioned envelope `{v, alg, nonce, ct}`.
- Opaque session tokens (SHA-256 at rest), sliding + absolute expiry; CLI uses ephemeral tokens.
- Single D1 database; per-item vault rows (plaintext sync metadata + encrypted payload).
- Last-write-wins per item; offline reads from local cache; writes online-only.
- CLI command name: `zuulp`. No `login`/`logout`/`sync` subcommands.
- Important crypto costs are client-side; Worker stays I/O-bound (respects 10 ms CPU limit).

## Open items / gotchas

- **Ordering decision (phase 5 vault slice before finishing phase 4):** the sync engine's semantics (revision bump, cursor, tombstones, LWW) are defined by the server, and routes are the only part that can be run by hand, so the vault routes were built and smoke-tested first; phase 4 (core sync) now targets a real local worker. Rejected the strict 4→5 plan order for MVP testability.
- **Vault cursor semantics:** `updated_at` is strictly increasing per user (write takes `max(now, user's MAX(updated_at)+1)`); the pull uses `updated_at > since`, cursor = last returned item's `updated_at` (or `since` for an empty page). Residual edge: two truly concurrent writes can read the same `MAX` and land the same `updated_at` — only harmful if a 500-row page boundary falls exactly between them (accepted for MVP). Two statements per write (`SELECT MAX` + write); watch the 50-queries-per-invocation guard.
- **Worker tests use an in-memory fake D1** (`packages/worker/src/vault.test.ts`), keyed to our exact SQL — it is a route-logic harness, not a D1 conformance test. `@cloudflare/vitest-pool-workers` (the documented worker test path, `docs/architecture.md` §10) is still not wired; deferred to phase 7 (integration tests). Vitest is currently 5.x, and pool-workers compatibility with it is unverified.
- **`pnpm integration-test` needs a running worker** (it is not part of `pnpm test`/CI yet): start `wrangler dev --env dev` (after applying migrations) then run it. It is a throwaway end-to-end check, not a repeatable fixture — it registers fresh random-email accounts and cleans up nothing. Wiring it into CI (ephemeral `wrangler dev` + D1) belongs to phase 7.
- **Local dev now needs `--env dev`:** bindings live only under `[env.dev]`/`[env.prod]` (no top-level D1). Use `wrangler dev --env dev` and `wrangler d1 migrations apply DB --local --env dev` (binding `DB`, not the database name). `PEPPER` is read from `packages/worker/.dev.vars`. Migration `0002_vault.sql` is applied locally; remote dev/prod apply it via the deploy workflow on the next `main` push.
- **`vault_items` id is client-generated** (uuid), scoped by `PRIMARY KEY (user_id, id)`; deleting an id with no server row succeeds without inserting a tombstone (no other device could hold it).

- **pnpm 12 build scripts:** dependency install scripts are blocked by default; allow-listed via `allowBuilds` in `pnpm-workspace.yaml` (`esbuild: true`, `workerd: true`, `sharp: false`). Add new entries there if future deps need install scripts.
- **Vitest root:** `vitest.config.ts` pins `test.root` to the repo root with include `packages/**/*.test.ts`, so tests are discoverable regardless of the cwd a package runs from.
- **Vitest upgraded to ^5.0.3** (was 2.1.9) — removes Vite's "CJS API deprecated" warning (Vite 6+/ESM). Root `package.json` now has `"type": "module"` (whole repo is ESM).
- **TypeScript kept at 5.9.x** — decision tracker: TS 7.x is the new native/Go compiler port; not adopted for the MVP. Revisit later.
- **Linter added:** ESLint 10 (flat `eslint.config.ts`) + `typescript-eslint` 8 + `eslint-config-prettier`. `pnpm lint` runs `eslint .`. Prettier ignores `docs/`, `dist`, lockfile via `.prettierignore`. All gates green: lint / typecheck / test.
- **ESLint config is now TypeScript + `defineConfig`:** `eslint.config.ts` uses ESLint core's `defineConfig`/`globalIgnores` from `eslint/config` (the `tseslint.config()` helper is deprecated). The TS config file requires `jiti` (>= 2.2.0 for ESLint 10) as a root devDependency on Node.js — keep it. The config file is not covered by any package `tsconfig` (no root tsconfig include), so it's loaded by jiti at lint time, not type-checked by `pnpm typecheck`.
- **`@scure/base` base32 gotcha:** the padded `base32` codec _rejects_ unpadded input on decode; use **`base32nopad`** for the recovery code (returns 52 chars / 32 bytes, decodes with or without the grouped separators). Recovery code is uppercase, grouped in 4s with `-`.
- **No `Envelope` field for AAD:** `aesGcmEncrypt` currently binds no additional authenticated data (envelope schema has no AAD field). If per-item AAD is wanted later, extend the envelope schema first.
- **`hkdf` info** takes `string | Uint8Array` so RFC 5869 vectors (arbitrary bytes) can be tested directly.
- **Design drift (recorded, `docs/architecture.md` §6 updated):** `POST /login` carries `email`; added `GET /account/keys` (Bearer) returning `protectedUsk` — a fresh client needs the wrapped USK to unlock the local cache.
- **Dev pepper / local vars:** no `vars` in `wrangler.toml` anymore. Local `wrangler dev` reads `PEPPER` from `packages/worker/.dev.vars` (gitignored via `.dev.vars*`); CI/remote set it with `wrangler secret put PEPPER --env dev|prod` from the GitHub Environment secret of the same name.
- **Running the worker locally:** `wrangler d1 migrations apply zuulpass --local` once, then `wrangler dev` (port 8787). Local D1 state lives under `.wrangler/` (gitignored).
- **Wrangler 4 / workers-types 5:** `wrangler` and `@cloudflare/workers-types` must stay on the same major (now 4 / 5); bumping one without the other risks binding-type drift. `wrangler deploy --dry-run` is the cheap config/bundle check (needs no auth).
- **zod 4:** schemas are zod 4 now; string formats like `.base64()` still work (deprecated in favor of top-level `z.base64()`), so future schemas should prefer the top-level forms.
- **JSDoc linting:** `eslint.config.ts` enables `eslint-plugin-jsdoc` for `**/*.ts` with `settings.jsdoc.mode = "typescript"`. `jsdoc/require-jsdoc` uses `publicOnly: true` and `contexts` for `TSInterfaceDeclaration`/`TSTypeAliasDeclaration`/`TSEnumDeclaration`; it does **not** require JSDoc on non-exported functions or on exported `const` values (e.g. zod schemas, Hono `requireAuth`) — document those when useful, but they are not enforced. `@returns` is omitted for `void`/`Promise<void>` functions that have no `return <value>`.
- **pnpm supply-chain gate:** installs enforce a minimum release age. Fresh versions need an allow-list entry; pnpm auto-added `minimumReleaseAgeExclude` for `@cloudflare/workers-types@5.20261011.1` and `zod@4.6.6` in `pnpm-workspace.yaml` — keep new entries there minimal and justified.
- **Scripting the CLI:** `pnpm --filter @zuulpass/cli start -- <cmd>` forwards `--` literally (commander reads it as end-of-options). Use `pnpm --filter @zuulpass/cli exec tsx src/index.ts <cmd> ...` when passing flags from a script.
- **`init` non-interactive:** with `--password-stdin` the recovery-code confirm is skipped (prints a warning instead).
- **CLI non-interactive mode:** `--password-stdin` (or any piped/non-TTY stdin) disables all interactive prompts — required values (`--email` on `init`, `--name` on `add`) must be passed as flags and other fields default to `""`. Rationale: reading to EOF from an interactive console is unreliable on Windows PowerShell (PSReadLine binds Ctrl+Z to Undo, so there's no working EOF keystroke), and a consumed stdin used to crash `@inquirer/prompts` with "User force closed the prompt".
- Committed `5388659 "Intermediate - working login prototype"` (login slice + `architecture.md` drift + stdin fix).
- **Dependency refresh done (Tier A + B):** bumped majors after a full inventory vs. mid-Oct-2026 latest — `zod` 3 → 4 (`api-types`), `wrangler` 3 → 4 + `@cloudflare/workers-types` 4 → 5 (`worker`), `@types/node` 22 → 24 (root + `core`; matches local Node 24.21), `prettier` 3.9.9 → 3.9.10. `compatibility_date` bumped `2024-09-23` → `2026-01-01`. zod 4 migration was drop-in (`.base64()` etc. all still valid); all gates green (77 tests). `wrangler deploy --dry-run` bundles clean under Wrangler 4. **Held:** TypeScript 5.9.x (skip 7.x native port) and `@types/node` 26 (24 is the settled LTS).
- **Deploy triggers:** `ci.yml` runs on **every** push (all branches) + PR + manual; `deploy.yml` runs **only on push to `main`** (+ manual `workflow_dispatch`). A push/merge to `main` fires both workflows at once, so merging green-done work deploys immediately.
- **Environments / plan availability:** the GitHub repo is private (anonymous API returns 404). On GitHub **Free**, environment protection rules — including **Required reviewers** — are only configurable for **public** repos, which is why Required reviewers isn't offered. Consequence: the `prod` environment is **not gated**, so `deploy-prod` runs automatically once `deploy-dev` succeeds. To gate prod, upgrade to GitHub Pro/Team or make the repo public. (Deployment branch = `main` was set on both environments.)
- **GitHub settings can't be verified from this machine:** no `gh` CLI and the repo is private. Confirm by hand — repo secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`; environment secret `PEPPER` under both `dev` and `prod`.
- **First-deploy ordering:** `wrangler secret put PEPPER` runs _after_ `wrangler deploy` (the Worker must already exist), so the very first deploy briefly serves without `PEPPER` (accepted). D1 migrations run before deploy; `wrangler d1 migrations apply` auto-skips its confirm prompt in CI and must use `--remote` (default is local) plus the database **name** (not binding) to avoid targeting the wrong DB.

## Handoff instructions

- **On every break/checkpoint:** update this file (status table + current phase + gotchas).
- **Start of every session:** read `docs/architecture.md` + this file.
- Commit at each milestone; keep `docs/architecture.md` in sync with any design drift.
