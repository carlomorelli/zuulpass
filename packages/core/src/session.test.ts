import type { Envelope } from "@zuulpass/api-types";
import { describe, expect, it } from "vitest";
import { bytesToBase64 } from "./bytes.js";
import { generateKdfParams } from "./kdf.js";
import { deriveKeys, generateUSK, wrapUSK } from "./keys.js";
import { unlock } from "./session.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// A minimal in-memory stand-in for the worker covering the three endpoints the
// unlock preamble touches, exercising the real key derivation + USK wrap.
function fakeServer(
  masterPassword: string,
  token = "t".repeat(32),
): { fetchImpl: typeof fetch; usk: Uint8Array; authHashesSeen: string[] } {
  const kdf = generateKdfParams();
  const usk = generateUSK();
  let protectedUsk: Envelope | undefined;
  const authHashesSeen: string[] = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname === "/params") {
      return json({ kdf, recoverySalt: "AAAA" });
    }
    if (url.pathname === "/login") {
      const body = JSON.parse(String(init?.body)) as { authHash?: string };
      const { authHash, stretchedKey } = await deriveKeys(masterPassword, kdf);
      authHashesSeen.push(body.authHash ?? "");
      if (body.authHash !== bytesToBase64(authHash)) {
        return json({ error: { code: "unauthorized", message: "nope" } }, 401);
      }
      protectedUsk ??= await wrapUSK(usk, stretchedKey);
      return json({ status: "ok", token, expiresAt: 999 });
    }
    if (url.pathname === "/account/keys") {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.authorization !== `Bearer ${token}`) {
        return json({ error: { code: "unauthorized", message: "nope" } }, 401);
      }
      return json({ protectedUsk });
    }
    return json({ error: { code: "not_found", message: "not found" } }, 404);
  };

  return { fetchImpl, usk, authHashesSeen };
}

describe("unlock", () => {
  it("logs in, fetches the wrapped USK and unwraps it", async () => {
    const masterPassword = "correct horse battery staple 42";
    const { fetchImpl, usk, authHashesSeen } = fakeServer(masterPassword);

    const session = await unlock({
      serverUrl: "http://fake",
      email: "a@b.co",
      masterPassword,
      fetch: fetchImpl,
    });

    expect(session.token).toBe("t".repeat(32));
    expect(session.usk).toEqual(usk);
    expect(authHashesSeen).toHaveLength(1);
  }, 20_000);

  it("rejects the wrong master password via the server", async () => {
    const { fetchImpl } = fakeServer("correct horse battery staple 42");
    await expect(
      unlock({
        serverUrl: "http://fake",
        email: "a@b.co",
        masterPassword: "wrong password long enough",
        fetch: fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
