-- Phase 5 vault storage (docs/architecture.md §5, §7). Per-item rows: only
-- plaintext sync metadata (id, revision, updated_at, deleted) plus the client's
-- ciphertext; the server never sees a payload. The (user_id, id) primary key
-- scopes opaque client-generated ids to their owner, and the
-- (user_id, updated_at) index backs the incremental `GET /vault?since=` pull.

CREATE TABLE vault_items (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  revision   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  ciphertext TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX idx_vault_items_user_updated ON vault_items(user_id, updated_at);
