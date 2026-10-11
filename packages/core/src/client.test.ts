import { describe, expect, it } from "vitest";
import { createApiClient, getParams, login } from "./client.js";
import { generateKdfParams } from "./kdf.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const fetchReturning =
  (res: Response): typeof fetch =>
  () =>
    Promise.resolve(res);

describe("createApiClient", () => {
  it("strips trailing slashes from the base URL", () => {
    expect(createApiClient("http://localhost:8787/").serverUrl).toBe(
      "http://localhost:8787",
    );
  });
});

describe("getParams", () => {
  it("validates and returns the params response", async () => {
    const kdf = generateKdfParams();
    const client = createApiClient(
      "http://x",
      fetchReturning(json({ kdf, recoverySalt: "AAAA" })),
    );
    expect((await getParams(client, "a@b.co")).kdf).toEqual(kdf);
  });

  it("rejects a malformed params response", async () => {
    const client = createApiClient("http://x", fetchReturning(json({})));
    await expect(getParams(client, "a@b.co")).rejects.toThrow();
  });
});

describe("error mapping", () => {
  it("maps a JSON error body to an ApiError", async () => {
    const client = createApiClient(
      "http://x",
      fetchReturning(
        json({ error: { code: "conflict", message: "taken" } }, 409),
      ),
    );
    await expect(
      login(client, { email: "a@b.co", authHash: "AAAA" }),
    ).rejects.toMatchObject({ code: "conflict", status: 409 });
  });
});
