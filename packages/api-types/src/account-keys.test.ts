import { describe, expect, it } from "vitest";
import {
  accountKeysResponseSchema,
  loginRequestSchema,
  type AccountKeysResponse,
} from "./index.js";

const b64 = (size = 32) => Buffer.alloc(size, 1).toString("base64");
const nonce = Buffer.alloc(12, 2).toString("base64");
const ct = Buffer.alloc(16, 3).toString("base64");

describe("login request", () => {
  it("carries the email and auth hash", () => {
    const req = { email: "a@example.com", authHash: b64() };
    expect(loginRequestSchema.parse(req)).toEqual(req);
  });

  it("requires an email", () => {
    expect(() => loginRequestSchema.parse({ authHash: b64() })).toThrow();
  });
});

describe("account keys response", () => {
  it("carries the wrapped USK envelope", () => {
    const res: AccountKeysResponse = accountKeysResponseSchema.parse({
      protectedUsk: { v: 1, alg: "AES-256-GCM", nonce, ct },
    });
    expect(res.protectedUsk.ct).toBe(ct);
  });

  it("rejects a non-envelope protected USK", () => {
    expect(() =>
      accountKeysResponseSchema.parse({ protectedUsk: "nope" }),
    ).toThrow();
  });
});
