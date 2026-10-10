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
- Testing: **Vitest**; worker tests via `@cloudflare/vitest-pool-workers`.
- Deployment: **Wrangler** (local dev `wrangler dev`, D1 migrations, `secret put` for the server pepper).
- CLI crypto and data models must not depend on UI libraries; `core` stays headless.

## Handoff discipline (IMPORTANT)

1. At the **start** of a work session, read `docs/architecture.md` and `STATUS.md`.
2. At every **checkpoint / break**, update `STATUS.md`: mark completed phases,
   note the current phase, and record any open decisions or gotchas so the next
   session (or a fresh one) can resume without re-deriving context.
3. Keep `docs/architecture.md` in sync with any design drift during implementation.
4. Commit at each milestone. Do not commit secrets (the D1 pepper must go through
   `wrangler secrets`, never the repo).