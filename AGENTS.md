# ZuulPass

Zero-knowledge password manager. Backend: Cloudflare Worker (free plan, D1).
Client: Node CLI (command name `zuulp`). All cryptography happens client-side;
the server stores only ciphertext and sync metadata.

## Where to start

- **Full design document:** [`docs/architecture.md`](docs/architecture.md) — read this first. It covers the key hierarchy, D1 schema, API surface, sync model, CLI commands, and build order. Keep it updated when design decisions change.
- **Status / handoff:** [`STATUS.md`](STATUS.md) — current progress, current phase, and gotchas.

## Repository layout (target)

```
packages/
  core/       # crypto, key hierarchy, sync engine, vault ops, config, local cache (no UI)
  api-types/  # Zod schemas + inferred types (single source of truth)
  worker/     # Hono on Cloudflare Workers
  cli/        # thin Node CLI over core + api-types
```

## Commands / conventions

- Package manager: **pnpm workspaces**. TypeScript strict; project references.
- Linting: **ESLint 10** flat config (`eslint.config.js`) + `typescript-eslint` + `eslint-config-prettier`; run with `pnpm lint`.
- Formatting: **Prettier** (`pnpm format`); `docs/` and lockfile are prettier-ignored.
- Testing: **Vitest**; worker tests via `@cloudflare/vitest-pool-workers`.
- Deployment: **Wrangler** (local dev `wrangler dev`, D1 migrations, `secret put` for the server pepper).
- CLI crypto and data models must not depend on UI libraries; `core` stays headless.

## Comments & documentation

- Use JSDoc block comments (`/** ... */`) for multi-line comments. Do **not**
  stack `//` line comments to write multi-line prose; reserve `//` for short,
  single-line clarifications.
- Every public (exported) class, interface, type, and method/function must have a
  JSDoc comment describing what it is or does.
- For methods and functions, document inputs and outputs in a basic way: an
  `@param` per parameter and `@returns` for the return value (omit `@returns`
  for `void`).
- Document failure modes with `@throws` when a call can raise (or reject / return
  an error) under conditions the caller is expected to handle.

## Code style

- **Always use curly braces for control-flow bodies** (`if`, `else`, `for`,
  `while`, `do`). Do not write brace-less one-liners such as
  `if (ok) return value;` — write the block form instead, for readability.

## Handoff discipline (IMPORTANT)

1. At the **start** of a work session, read `docs/architecture.md` and `STATUS.md`.
2. At every **checkpoint / break**, update `STATUS.md`: mark completed phases,
   note the current phase, and record any open decisions or gotchas so the next
   session (or a fresh one) can resume without re-deriving context.
3. Keep `docs/architecture.md` in sync with any design drift during implementation.
4. **NEVER commit changes autonomously.** Do not run `git commit` unless the user explicitly asks you to commit. Always pause for confirmation before creating a commit. Do not commit secrets (the D1 pepper must go through `wrangler secrets`, never the repo).
5. If you create or modify files, show the proposed changes and wait for user approval before committing them.

## Verification gate (IMPORTANT)

After implementing or changing code, regularly run **all** of these, not just
build/test. Expect a clean exit from every one before considering work done:

- `pnpm lint` — ESLint (flat config, see above)
- `pnpm typecheck` — TypeScript strict across all packages
- `pnpm test` — Vitest (single workspace-wide run)
- `pnpm format` — Prettier (writes; `docs/` and lockfile are ignored)

Run Prettier over changed files before finishing a change so formatting stays
canonical; if `pnpm lint` or `pnpm typecheck` reports issues, fix your code (or,
only with reason, adjust the lint config) rather than silencing rules.
