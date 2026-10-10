# ZuulPass — Project Status

> Handoff note. Update this file at every checkpoint: mark completed work,
> note current phase, and record any gotchas or open decisions for the next
> session. A fresh session should read this file **before** reading code.

## Project

A zero-knowledge password manager. Cloudflare Worker backend (D1 storage) +
Node CLI client. Full design: [`docs/architecture.md`](docs/architecture.md).

## MVP build order (per `docs/architecture.md` §11)

| # | Phase | Status |
|---|-------|--------|
| 1 | Scaffold monorepo (pnpm, base tsconfig, vitest) | **done** |
| 2 | `api-types`: Zod schemas for endpoints + payloads | pending |
| 3 | `core` crypto: PBKDF2/HKDF/AES-GCM envelope, key hierarchy, recovery (+ test vectors) | pending |
| 4 | `core`: config, local encrypted cache, sync engine, headless `VaultService` | pending |
| 5 | `worker`: Hono routes, D1 schema + migrations, auth/sessions, vault CRUD, sync | pending |
| 6 | `cli`: `init`, unlock/sync preamble, `get`/`ls`, `add`/`edit`/`rm`, `gen`, `change-master-password`, `recover` | pending |
| 7 | Integration tests (CLI <-> local Worker) + CI | pending |

## Current phase

Phase 2 — `api-types`: Zod schemas for every endpoint + payloads. **Not started.**

## Completed so far

- `docs/architecture.md` — full design document (crypto, key hierarchy, D1 schema, API, CLI, sync, Mermaid diagrams).
- Git repo initialized; first commit `868e8c3 "Design document"`.
- **Phase 1 done:** pnpm workspace scaffolded (`pnpm` 12.11.2, Node 24). Root configs: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.npmrc`.
- Packages created: `@zuulpass/core`, `@zuulpass/api-types` (zod dep), `@zuulpass/worker` (wrangler + workers-types dev deps), `@zuulpass/cli`.
- `pnpm typecheck` passes (all 4 packages); `pnpm test` passes (1 smoke test); `pnpm --filter @zuulpass/cli start` runs via tsx.

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
- Vitest 2.1.x prints a harmless "CJS build of Vite's Node API is deprecated" warning — consider upgrading Vitest to v3 later.
- Nothing committed for phase 1 yet (awaiting explicit commit instruction).

## Handoff instructions

- **On every break/checkpoint:** update this file (status table + current phase + gotchas).
- **Start of every session:** read `docs/architecture.md` + this file.
- Commit at each milestone; keep `docs/architecture.md` in sync with any design drift.