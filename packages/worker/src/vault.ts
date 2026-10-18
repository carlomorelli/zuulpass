import {
  vaultDeleteRequestSchema,
  vaultPullResponseSchema,
  vaultPutRequestSchema,
  vaultWriteResponseSchema,
} from "@zuulpass/api-types";
import type { Hono } from "hono";
import { requireAuth } from "./auth.js";
import type { Env, Variables } from "./env.js";
import { errorBody, readJson } from "./http.js";

/**
 * Maximum rows returned by one `GET /vault` page (free-plan rows-read guard).
 * Clients keep pulling with the returned cursor until a short page comes back.
 */
export const PULL_PAGE_SIZE = 500;

/** Shape of a `vault_items` row as selected by the pull query. */
interface VaultItemRow {
  id: string;
  revision: number;
  updated_at: number;
  deleted: number;
  ciphertext: string;
}

/**
 * Compute the next `updated_at` for a user's write: strictly greater than
 * every existing `updated_at` of that user (via `SELECT MAX(...) + 1`), but
 * never behind the wall clock. Strictly increasing, per-user timestamps keep
 * the `updated_at > since` incremental cursor tie-free (docs/architecture.md §7).
 * @param env - Worker bindings (D1).
 * @param userId - The owner of the row being written.
 * @returns The timestamp (epoch ms) to store on the row.
 */
async function nextUpdatedAt(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT MAX(updated_at) AS max_updated_at FROM vault_items WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ max_updated_at: number | null }>();
  return Math.max(Date.now(), (row?.max_updated_at ?? 0) + 1);
}

/**
 * Register the vault CRUD/sync routes (docs/architecture.md §6, §7) on the
 * app. Every route sits behind `requireAuth` and only ever touches ciphertext
 * and plaintext sync metadata (last-write-wins per item, tombstones for
 * deletes).
 * @param app - The Hono app (or sub-app) to register the routes on.
 */
export function registerVaultRoutes(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
): void {
  /**
   * GET /vault?since=<cursor> -> incremental pull: every item of the caller
   * whose `updated_at` exceeds the cursor, oldest first, plus the new cursor.
   */
  app.get("/vault", requireAuth, async (c) => {
    const sinceRaw = c.req.query("since");
    let since = 0;
    if (sinceRaw !== undefined) {
      if (!/^\d+$/.test(sinceRaw)) {
        return c.json(
          errorBody("invalid_request", "since must be a non-negative integer"),
          400,
        );
      }
      since = Number(sinceRaw);
    }
    const rows = await c.env.DB.prepare(
      `SELECT id, revision, updated_at, deleted, ciphertext
         FROM vault_items
        WHERE user_id = ? AND updated_at > ?
        ORDER BY updated_at ASC
        LIMIT ?`,
    )
      .bind(c.get("userId"), since, PULL_PAGE_SIZE)
      .all<VaultItemRow>();
    const items = rows.results.map((row) => ({
      id: row.id,
      revision: row.revision,
      updatedAt: row.updated_at,
      deleted: row.deleted !== 0,
      ciphertext: row.ciphertext,
    }));
    const cursor = items.at(-1)?.updatedAt ?? since;
    return c.json(vaultPullResponseSchema.parse({ items, cursor }));
  });

  /**
   * POST /vault/items -> upsert one item. Last-write-wins: a stale
   * `baseRevision` is accepted, never rejected (docs/architecture.md §17);
   * writing over a tombstone resurrects the item.
   */
  app.post("/vault/items", requireAuth, async (c) => {
    const parsed = vaultPutRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return c.json(
        errorBody("invalid_request", "invalid vault put body"),
        400,
      );
    }
    const { id, baseRevision, ciphertext } = parsed.data;
    const userId = c.get("userId");
    const existing = await c.env.DB.prepare(
      "SELECT revision FROM vault_items WHERE user_id = ? AND id = ?",
    )
      .bind(userId, id)
      .first<{ revision: number }>();
    const revision = (existing?.revision ?? baseRevision) + 1;
    const updatedAt = await nextUpdatedAt(c.env, userId);
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE vault_items
            SET revision = ?, updated_at = ?, deleted = 0, ciphertext = ?
          WHERE user_id = ? AND id = ?`,
      )
        .bind(revision, updatedAt, ciphertext, userId, id)
        .run();
    } else {
      await c.env.DB.prepare(
        `INSERT INTO vault_items (id, user_id, revision, updated_at, deleted, ciphertext)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
        .bind(id, userId, revision, updatedAt, ciphertext)
        .run();
    }
    return c.json(vaultWriteResponseSchema.parse({ revision, updatedAt }));
  });

  /**
   * DELETE /vault/items/:id -> tombstone the item (or no-op if it is already
   * deleted/absent), so the deletion propagates on every device's next pull.
   */
  app.delete("/vault/items/:id", requireAuth, async (c) => {
    const id = c.req.param("id");
    if (!id || id.length > 64) {
      return c.json(errorBody("invalid_request", "invalid item id"), 400);
    }
    const parsed = vaultDeleteRequestSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return c.json(
        errorBody("invalid_request", "invalid vault delete body"),
        400,
      );
    }
    const userId = c.get("userId");
    const existing = await c.env.DB.prepare(
      "SELECT revision, deleted, updated_at FROM vault_items WHERE user_id = ? AND id = ?",
    )
      .bind(userId, id)
      .first<{ revision: number; deleted: number; updated_at: number }>();
    if (!existing) {
      // Nothing on the server to tombstone: report success so the caller can
      // drop its local copy (the item never left this device anyway).
      return c.json(
        vaultWriteResponseSchema.parse({
          revision: parsed.data.baseRevision + 1,
          updatedAt: Date.now(),
        }),
      );
    }
    if (existing.deleted !== 0) {
      return c.json(
        vaultWriteResponseSchema.parse({
          revision: existing.revision,
          updatedAt: existing.updated_at,
        }),
      );
    }
    const revision = existing.revision + 1;
    const updatedAt = await nextUpdatedAt(c.env, userId);
    await c.env.DB.prepare(
      `UPDATE vault_items
          SET revision = ?, updated_at = ?, deleted = 1
        WHERE user_id = ? AND id = ?`,
    )
      .bind(revision, updatedAt, userId, id)
      .run();
    return c.json(vaultWriteResponseSchema.parse({ revision, updatedAt }));
  });
}
