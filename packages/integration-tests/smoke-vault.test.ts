import process from "node:process";
import { describe, expect, it } from "vitest";

const base = (() => {
  const flagIndex = process.argv.indexOf("--server");
  const fromFlag = flagIndex >= 0 ? process.argv[flagIndex + 1] : undefined;
  return (
    fromFlag ??
    process.env.ZUULPASS_SMOKE_URL ??
    "http://127.0.0.1:8787"
  ).replace(/\/+$/, "");
})();

interface SmokeState {
  token?: string;
  firstCursor?: number;
  secondToken?: string;
}

const state: SmokeState = {};
const email = `smoke-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`;
const authHash = "YXV0aA==";
const envelope = {
  v: 1,
  alg: "AES-256-GCM",
  nonce: "AAAAAAAAAAAAAAAAAAAAAA==",
  ct: "aGVsbG8=",
};

interface ApiOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

function need<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`missing ${name} from an earlier failing check`);
  }
  return value;
}

async function api(path: string, init: ApiOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (init.token) {
    headers.authorization = `Bearer ${init.token}`;
  }
  const requestInit: RequestInit = { method: init.method ?? "GET", headers };
  if (init.body !== undefined) {
    requestInit.body = JSON.stringify(init.body);
  }
  return fetch(`${base}${path}`, requestInit);
}

describe("worker smoke", () => {
  it("GET /health reports ok", async () => {
    const res = await api("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /account/register creates the account", async () => {
    const res = await api("/account/register", {
      method: "POST",
      body: {
        email,
        kdf: {
          kdf: "pbkdf2",
          salt: "c2FsdHNhbHRzYWx0c2FsdA==",
          iterations: 600000,
          version: 1,
        },
        protectedUsk: envelope,
        recoveryProtectedUsk: envelope,
        recoverySalt: "cmVjb3ZlcnlzYWx0cmVjb3Zlcnk=",
        authHash,
        recoveryAuth: "cmVj",
      },
    });
    expect(res.status).toBe(201);
  });

  it("registering the same email conflicts", async () => {
    const res = await api("/account/register", {
      method: "POST",
      body: {
        email,
        kdf: {
          kdf: "pbkdf2",
          salt: "c2FsdHNhbHRzYWx0c2FsdA==",
          iterations: 600000,
          version: 1,
        },
        protectedUsk: envelope,
        recoveryProtectedUsk: envelope,
        recoverySalt: "cmVjb3ZlcnlzYWx0cmVjb3Zlcnk=",
        authHash,
        recoveryAuth: "cmVj",
      },
    });
    expect(res.status).toBe(409);
  });

  it("login rejects a wrong password", async () => {
    const res = await api("/login", {
      method: "POST",
      body: { email, authHash: "d3Jvbmc=" },
    });
    expect(res.status).toBe(401);
  });

  it("login returns an ephemeral session token", async () => {
    const res = await api("/login", {
      method: "POST",
      body: { email, authHash },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; token?: string };
    expect(body.status).toBe("ok");
    expect(typeof body.token).toBe("string");
    expect(body.token).toBeTruthy();
    if (body.token === undefined) {
      throw new Error("login did not return a token");
    }
    state.token = body.token;
  });

  it("GET /vault requires a token", async () => {
    const res = await api("/vault");
    expect(res.status).toBe(401);
  });

  it("GET /vault rejects a malformed cursor", async () => {
    const res = await api("/vault?since=nope", {
      token: need(state.token, "token"),
    });
    expect(res.status).toBe(400);
  });

  it("GET /vault starts empty", async () => {
    const res = await api("/vault?since=0", {
      token: need(state.token, "token"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; cursor: number };
    expect(body.items).toHaveLength(0);
    expect(body.cursor).toBe(0);
  });

  it("POST /vault/items inserts at revision 1", async () => {
    const res = await api("/vault/items", {
      method: "POST",
      token: need(state.token, "token"),
      body: { id: "smoke-1", baseRevision: 0, ciphertext: "aGVsbG8=" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number; updatedAt: number };
    expect(body.revision).toBe(1);
    state.firstCursor = body.updatedAt;
  });

  it("GET /vault returns the inserted item and advances the cursor", async () => {
    const res = await api("/vault?since=0", {
      token: need(state.token, "token"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        id: string;
        revision: number;
        deleted: boolean;
        ciphertext: string;
        updatedAt: number;
      }[];
      cursor: number;
    };
    const item = body.items.find((i) => i.id === "smoke-1");
    expect(item).toBeDefined();
    expect(item?.deleted).toBe(false);
    expect(item?.ciphertext).toBe("aGVsbG8=");
    expect(body.cursor).toBe(item?.updatedAt);
  });

  it("POST /vault/items accepts a stale baseRevision (LWW)", async () => {
    const res = await api("/vault/items", {
      method: "POST",
      token: need(state.token, "token"),
      body: { id: "smoke-1", baseRevision: 0, ciphertext: "d29ybGQ=" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBe(2);
  });

  it("incremental pull only returns items newer than the cursor", async () => {
    const res = await api(`/vault?since=${need(state.firstCursor, "cursor")}`, {
      token: need(state.token, "token"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; revision: number; ciphertext: string }[];
    };
    const item = body.items.find((i) => i.id === "smoke-1");
    expect(item).toBeDefined();
    expect(item?.revision).toBe(2);
    expect(item?.ciphertext).toBe("d29ybGQ=");
  });

  it("DELETE /vault/items/:id writes a tombstone", async () => {
    const res = await api("/vault/items/smoke-1", {
      method: "DELETE",
      token: need(state.token, "token"),
      body: { baseRevision: 2 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBe(3);
    const pull = await api("/vault?since=0", {
      token: need(state.token, "token"),
    });
    expect(pull.status).toBe(200);
    const pulled = (await pull.json()) as {
      items: { id: string; deleted: boolean }[];
    };
    const item = pulled.items.find((i) => i.id === "smoke-1");
    expect(item).toBeDefined();
    expect(item?.deleted).toBe(true);
  });

  it("DELETE /vault/items/:id is idempotent", async () => {
    const res = await api("/vault/items/smoke-1", {
      method: "DELETE",
      token: need(state.token, "token"),
      body: { baseRevision: 3 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBe(3);
  });

  it("vault items are scoped per user", async () => {
    const secondEmail = `smoke-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const registration = await api("/account/register", {
      method: "POST",
      body: {
        email: secondEmail,
        kdf: {
          kdf: "pbkdf2",
          salt: "c2FsdHNhbHRzYWx0c2FsdA==",
          iterations: 600000,
          version: 1,
        },
        protectedUsk: envelope,
        recoveryProtectedUsk: envelope,
        recoverySalt: "cmVjb3ZlcnlzYWx0cmVjb3Zlcnk=",
        authHash,
        recoveryAuth: "cmVj",
      },
    });
    expect(registration.status).toBe(201);
    const login = await api("/login", {
      method: "POST",
      body: { email: secondEmail, authHash },
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { token: string };
    state.secondToken = loginBody.token;
    const pull = await api("/vault?since=0", { token: loginBody.token });
    expect(pull.status).toBe(200);
    const body = (await pull.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });

  it("POST /vault/items rejects an invalid body", async () => {
    const res = await api("/vault/items", {
      method: "POST",
      token: need(state.token, "token"),
      body: { id: "smoke-1", baseRevision: 0 },
    });
    expect(res.status).toBe(400);
  });
});
