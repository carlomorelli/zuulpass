import { describe, expect, it } from "vitest";
import {
  vaultPullResponseSchema,
  vaultWriteResponseSchema,
} from "@zuulpass/api-types";
import app from "./index.js";
import type { Env } from "./env.js";
import { sha256Hex } from "./crypto.js";

interface VaultRow {
  id: string;
  user_id: string;
  revision: number;
  updated_at: number;
  deleted: number;
  ciphertext: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  absolute_expires_at: number;
}

interface FakeDb {
  vault: VaultRow[];
  sessions: SessionRow[];
  db: D1Database;
}

/**
 * Minimal in-memory D1 stand-in that recognizes exactly the queries the vault
 * routes and the auth middleware issue. Enough to exercise route logic (status
 * codes, validation, LWW/tombstone semantics, cursor math) without workerd.
 * @returns A fresh fake database plus its backing arrays for assertions.
 */
function createFakeDb(): FakeDb {
  const vault: VaultRow[] = [];
  const sessions: SessionRow[] = [];

  function exec(sql: string, args: unknown[]): unknown {
    if (sql.includes("FROM sessions WHERE token_hash")) {
      return sessions.find((s) => s.token_hash === args[0]) ?? null;
    }
    if (sql.includes("UPDATE sessions SET last_seen_at")) {
      const session = sessions.find((s) => s.id === args[2]);
      if (session) {
        session.last_seen_at = args[0] as number;
        session.expires_at = args[1] as number;
      }
      return {};
    }
    if (sql.includes("SELECT MAX(updated_at)")) {
      const max = vault
        .filter((v) => v.user_id === args[0])
        .reduce((m, v) => Math.max(m, v.updated_at), 0);
      return { max_updated_at: max === 0 ? null : max };
    }
    if (sql.includes("SELECT revision, deleted, updated_at FROM vault_items")) {
      const row = vault.find((v) => v.user_id === args[0] && v.id === args[1]);
      return row
        ? {
            revision: row.revision,
            deleted: row.deleted,
            updated_at: row.updated_at,
          }
        : null;
    }
    if (sql.includes("SELECT revision FROM vault_items")) {
      const row = vault.find((v) => v.user_id === args[0] && v.id === args[1]);
      return row ? { revision: row.revision } : null;
    }
    if (sql.includes("FROM vault_items") && sql.includes("updated_at > ?")) {
      const [userId, since, limit] = args as [string, number, number];
      return vault
        .filter((v) => v.user_id === userId && v.updated_at > since)
        .sort((a, b) => a.updated_at - b.updated_at)
        .slice(0, limit)
        .map((v) => ({
          id: v.id,
          revision: v.revision,
          updated_at: v.updated_at,
          deleted: v.deleted,
          ciphertext: v.ciphertext,
        }));
    }
    if (sql.includes("INSERT INTO vault_items")) {
      const [id, user_id, revision, updated_at, ciphertext] = args as [
        string,
        string,
        number,
        number,
        string,
      ];
      vault.push({ id, user_id, revision, updated_at, deleted: 0, ciphertext });
      return {};
    }
    if (sql.includes("UPDATE vault_items") && sql.includes("deleted = 1")) {
      const [revision, updated_at, userId, id] = args as [
        number,
        number,
        string,
        string,
      ];
      const row = vault.find((v) => v.user_id === userId && v.id === id);
      if (row) {
        row.revision = revision;
        row.updated_at = updated_at;
        row.deleted = 1;
      }
      return {};
    }
    if (sql.includes("UPDATE vault_items")) {
      const [revision, updated_at, ciphertext, userId, id] = args as [
        number,
        number,
        string,
        string,
        string,
      ];
      const row = vault.find((v) => v.user_id === userId && v.id === id);
      if (row) {
        row.revision = revision;
        row.updated_at = updated_at;
        row.deleted = 0;
        row.ciphertext = ciphertext;
      }
      return {};
    }
    throw new Error(`fake D1: unexpected SQL: ${sql.replace(/\s+/g, " ")}`);
  }

  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async <T>() => exec(sql, args) as T | null,
        all: async <T>() => ({
          results: exec(sql, args) as T[],
          success: true,
          meta: {},
        }),
        run: async () => {
          exec(sql, args);
          return { success: true, results: [], meta: {} };
        },
      }),
    }),
  } as unknown as D1Database;

  return { vault, sessions, db };
}

const TOKEN = "user-1-token";
const TOKEN2 = "user-2-token";
const CIPHERTEXT = "aGVsbG8=";

/**
 * Build a fake environment with two authenticated users sharing one database.
 * @returns The fake database and a Worker `Env` bound to it.
 */
async function setup(): Promise<{ fake: FakeDb; env: Env }> {
  const fake = createFakeDb();
  const now = Date.now();
  for (const [userId, token] of [
    ["user-1", TOKEN],
    ["user-2", TOKEN2],
  ] as const) {
    fake.sessions.push({
      id: `sess-${userId}`,
      user_id: userId,
      token_hash: await sha256Hex(token),
      created_at: now,
      last_seen_at: now,
      expires_at: now + 3_600_000,
      absolute_expires_at: now + 86_400_000,
    });
  }
  return {
    fake,
    env: { DB: fake.db, PEPPER: "test-pepper" } as unknown as Env,
  };
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/**
 * Return the first element of a known-non-empty array, for use in assertions.
 * @param arr - The array to read from.
 * @returns The first element.
 * @throws If the array is empty.
 */
function firstOf<T>(arr: T[]): T {
  const value = arr[0];
  if (value === undefined) {
    throw new Error("expected a non-empty array");
  }
  return value;
}

/**
 * Issue a request against the Worker app with a JSON body.
 * @param env - The Worker environment.
 * @param path - The request path.
 * @param init - Method/headers/body overrides.
 * @returns The fetch response.
 */
async function call(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(path, init, env);
}

describe("GET /vault", () => {
  it("rejects requests without a token", async () => {
    const { env } = await setup();
    const res = await call(env, "/vault");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed `since` cursor", async () => {
    const { env } = await setup();
    const res = await call(env, "/vault?since=abc", {
      headers: headers(TOKEN),
    });
    expect(res.status).toBe(400);
  });

  it("returns an empty page and echoes the cursor", async () => {
    const { env } = await setup();
    const res = await call(env, "/vault?since=42", { headers: headers(TOKEN) });
    expect(res.status).toBe(200);
    const body = vaultPullResponseSchema.parse(await res.json());
    expect(body.items).toEqual([]);
    expect(body.cursor).toBe(42);
  });

  it("returns only items newer than the cursor and advances it", async () => {
    const { env, fake } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    const first = vaultPullResponseSchema.parse(
      await (
        await call(env, "/vault?since=0", { headers: headers(TOKEN) })
      ).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(firstOf(first.items).id).toBe("a");
    expect(first.cursor).toBe(firstOf(first.items).updatedAt);

    const atCursor = vaultPullResponseSchema.parse(
      await (
        await call(env, `/vault?since=${first.cursor}`, {
          headers: headers(TOKEN),
        })
      ).json(),
    );
    expect(atCursor.items).toEqual([]);

    firstOf(fake.vault).updated_at = first.cursor + 5;
    const second = vaultPullResponseSchema.parse(
      await (
        await call(env, `/vault?since=${first.cursor}`, {
          headers: headers(TOKEN),
        })
      ).json(),
    );
    expect(second.items.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("POST /vault/items", () => {
  it("rejects an invalid body", async () => {
    const { env } = await setup();
    const res = await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({ id: "a", baseRevision: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("inserts a new item at revision 1", async () => {
    const { env, fake } = await setup();
    const res = await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    expect(res.status).toBe(200);
    const body = vaultWriteResponseSchema.parse(await res.json());
    expect(body.revision).toBe(1);
    expect(fake.vault).toHaveLength(1);
    expect(firstOf(fake.vault).deleted).toBe(0);
    expect(firstOf(fake.vault).ciphertext).toBe(CIPHERTEXT);
  });

  it("accepts a stale baseRevision and bumps the server revision (LWW)", async () => {
    const { env } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    const res = await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: "d29ybGQ=",
      }),
    });
    const body = vaultWriteResponseSchema.parse(await res.json());
    expect(body.revision).toBe(2);
    const pull = vaultPullResponseSchema.parse(
      await (await call(env, "/vault", { headers: headers(TOKEN) })).json(),
    );
    expect(firstOf(pull.items).ciphertext).toBe("d29ybGQ=");
  });

  it("resurrects a tombstoned item", async () => {
    const { env, fake } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    await call(env, "/vault/items/a", {
      method: "DELETE",
      headers: headers(TOKEN),
      body: JSON.stringify({ baseRevision: 1 }),
    });
    expect(firstOf(fake.vault).deleted).toBe(1);
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 2,
        ciphertext: "d29ybGQ=",
      }),
    });
    expect(firstOf(fake.vault).deleted).toBe(0);
  });

  it("scopes items to their owner", async () => {
    const { env } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    const pull = vaultPullResponseSchema.parse(
      await (await call(env, "/vault", { headers: headers(TOKEN2) })).json(),
    );
    expect(pull.items).toEqual([]);
  });
});

describe("DELETE /vault/items/:id", () => {
  it("writes a tombstone that the pull reports", async () => {
    const { env } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    const del = await call(env, "/vault/items/a", {
      method: "DELETE",
      headers: headers(TOKEN),
      body: JSON.stringify({ baseRevision: 1 }),
    });
    const body = vaultWriteResponseSchema.parse(await del.json());
    expect(body.revision).toBe(2);
    const pull = vaultPullResponseSchema.parse(
      await (await call(env, "/vault", { headers: headers(TOKEN) })).json(),
    );
    expect(pull.items).toHaveLength(1);
    expect(firstOf(pull.items).deleted).toBe(true);
  });

  it("is idempotent for an already-deleted item", async () => {
    const { env } = await setup();
    await call(env, "/vault/items", {
      method: "POST",
      headers: headers(TOKEN),
      body: JSON.stringify({
        id: "a",
        baseRevision: 0,
        ciphertext: CIPHERTEXT,
      }),
    });
    const first = vaultWriteResponseSchema.parse(
      await (
        await call(env, "/vault/items/a", {
          method: "DELETE",
          headers: headers(TOKEN),
          body: JSON.stringify({ baseRevision: 1 }),
        })
      ).json(),
    );
    const second = vaultWriteResponseSchema.parse(
      await (
        await call(env, "/vault/items/a", {
          method: "DELETE",
          headers: headers(TOKEN),
          body: JSON.stringify({ baseRevision: 2 }),
        })
      ).json(),
    );
    expect(second).toEqual(first);
  });

  it("does not create a row for an unknown item", async () => {
    const { env, fake } = await setup();
    const res = await call(env, "/vault/items/ghost", {
      method: "DELETE",
      headers: headers(TOKEN),
      body: JSON.stringify({ baseRevision: 0 }),
    });
    expect(res.status).toBe(200);
    expect(fake.vault).toEqual([]);
  });
});
