-- Phase 5 initial schema (docs/architecture.md §5). Session/vault rows only ever
-- hold ciphertext or hashes; the server never sees plaintext or raw keys.

CREATE TABLE users (
  id                     TEXT PRIMARY KEY,
  email                  TEXT NOT NULL UNIQUE,
  created_at             INTEGER NOT NULL,
  kdf                    TEXT NOT NULL,
  kdf_salt               TEXT NOT NULL,
  kdf_params             TEXT NOT NULL,
  kdf_version            INTEGER NOT NULL,
  protected_usk          TEXT NOT NULL,
  recovery_protected_usk TEXT NOT NULL,
  recovery_salt          TEXT NOT NULL,
  auth_verifier          TEXT NOT NULL,
  recovery_verifier      TEXT NOT NULL
);

CREATE TABLE sessions (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  token_hash          TEXT NOT NULL,
  kind                TEXT NOT NULL,
  label               TEXT,
  created_at          INTEGER NOT NULL,
  last_seen_at        INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
