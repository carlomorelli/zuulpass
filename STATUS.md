# ZuulPass — Project Status

> Handoff note. Update this file at every checkpoint: mark completed work,
> note current phase, and record any gotchas or open decisions for the next
> session. A fresh session should read this file **before** reading code.

## Project

A zero-knowledge password manager. Cloudflare Worker backend (D1 storage) +
Node CLI client. Full design: [`docs/architecture.md`](docs/architecture.md).

## MVP build order (per `docs/architecture.md` §11)

| #   | Phase                                                                                                          | Status   |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | Scaffold monorepo (pnpm, base tsconfig, vitest)                                                                | **done** |
| 2   | `api-types`: Zod schemas for endpoints + payloads                                                              | **done** |
| 3   | `core` crypto: PBKDF2/HKDF/AES-GCM envelope, key hierarchy, recovery (+ test vectors)                          | **done** |
| 4   | `core`: config, local encrypted cache, sync engine, headless `VaultService`                                    | pending  |
| 5   | `worker`: Hono routes, D1 schema + migrations, auth/sessions, vault CRUD, sync                                 | pending  |
| 6   | `cli`: `init`, unlock/sync preamble, `get`/`ls`, `add`/`edit`/`rm`, `gen`, `change-master-password`, `recover` | pending  |
| 7   | Integration tests (CLI <-> local Worker) + CI                                                                  | pending  |

## Current phase

Phase 3 — `core` crypto. **Done.** Next: Phase 4 — `core` config, local encrypted cache, sync engine, headless `VaultService`. **Not started.**

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
- **Linter added:** ESLint 10 (flat `eslint.config.js`) + `typescript-eslint` 8 + `eslint-config-prettier`. `pnpm lint` runs `eslint .`. Prettier ignores `docs/`, `dist`, lockfile via `.prettierignore`. All gates green: lint / typecheck / test.
- **`@scure/base` base32 gotcha:** the padded `base32` codec *rejects* unpadded input on decode; use **`base32nopad`** for the recovery code (returns 52 chars / 32 bytes, decodes with or without the grouped separators). Recovery code is uppercase, grouped in 4s with `-`.
- **No `Envelope` field for AAD:** `aesGcmEncrypt` currently binds no additional authenticated data (envelope schema has no AAD field). If per-item AAD is wanted later, extend the envelope schema first.
- **`hkdf` info** takes `string | Uint8Array` so RFC 5869 vectors (arbitrary bytes) can be tested directly.
- Nothing committed for phase 2/3 / tooling bumps yet (awaiting explicit commit instruction).

## Handoff instructions

- **On every break/checkpoint:** update this file (status table + current phase + gotchas).
- **Start of every session:** read `docs/architecture.md` + this file.
- Commit at each milestone; keep `docs/architecture.md` in sync with any design drift.
