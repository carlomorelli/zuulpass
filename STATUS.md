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
| 7   | Integration tests (CLI <-> local Worker) + CI                                                                  | pending     |

## Current phase

Phase 3 — `core` crypto. **Done.** Login-session slice shipped (phases 4/5/6
partial): a real register/login/session path against the Worker plus
`zuulp init / add / ls` on a local USK-encrypted cache (`cache.enc`).

**Next:** Worker vault CRUD + incremental sync (`/vault`, D1 `vault_items`),
offline cache fallback, and the remaining CLI commands (`get`, `edit`, `rm`,
`gen`, `change-master-password`, `recover`).

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
- **JSDoc standard enforced across all packages:** added the "Comments & documentation" section to `AGENTS.md` (JSDoc `/** ... */` for multi-line comments; document every public/exported class, interface, type, method, and function; `@param`/`@returns`/`@throws`). Added `eslint-plugin-jsdoc` (^65.3.0) configured in `eslint.config.ts` (`jsdoc/require-jsdoc` with `publicOnly` + TS contexts, plus `require-param(-description)`, `require-returns(-description)`, `require-throws`). Documented all public exports across `api-types`, `core`, and `worker` and converted multi-line `//` prose to JSDoc. All gates green: lint / typecheck / test (77) / format. **Not yet committed.**

## Key conventions / locked decisions (short version)

- Zero-knowledge; PBKDF2-HMAC-SHA256 @ 600k (Argon2id migration path kept).
- AES-256-GCM via WebCrypto; HKDF-SHA256 subkeys; versioned envelope `{v, alg, nonce, ct}`.
- Opaque session tokens (SHA-256 at rest), sliding + absolute expiry; CLI uses ephemeral tokens.
- Single D1 database; per-item vault rows (plaintext sync metadata + encrypted payload).
- Last-write-wins per item; offline reads from local cache; writes online-only.
- CLI command name: `zuulp`. No `login`/`logout`/`sync` subcommands.
- Important crypto costs are client-side; Worker stays I/O-bound (respects 10 ms CPU limit).

## Open items / gotchas

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
- **Dev pepper:** `[vars] PEPPER` in `wrangler.toml` is dev-only. For any real deployment, remove it and use `wrangler secret put PEPPER`.
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

## Handoff instructions

- **On every break/checkpoint:** update this file (status table + current phase + gotchas).
- **Start of every session:** read `docs/architecture.md` + this file.
- Commit at each milestone; keep `docs/architecture.md` in sync with any design drift.
