// Worker bindings (wrangler.toml).
export interface Env {
  DB: D1Database;
  // Server pepper: verifiers are stored as HMAC-SHA256(pepper, proof). Never
  // derivable from the DB alone (docs/architecture.md §2, §4).
  PEPPER: string;
}

export interface Variables {
  userId: string;
  sessionId: string;
}
