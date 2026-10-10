import { describe, expect, it } from "vitest";
import {
  changeMasterPasswordRequestSchema,
  kdfParamsSchema,
  loginResponseSchema,
  paramsResponseSchema,
  recoverRequestSchema,
  registerRequestSchema,
  vaultItemSchema,
  vaultPullResponseSchema,
  vaultPutRequestSchema,
} from "./index.js";

const b64 = (size = 32) => Buffer.alloc(size, 1).toString("base64");
const nonce = Buffer.alloc(12, 2).toString("base64");
const ct = Buffer.alloc(16, 3).toString("base64");
const b2i = (base64: string) => Buffer.from(base64, "base64");

const validRegister = {
  email: "a@example.com",
  kdf: { kdf: "pbkdf2", salt: b64(), iterations: 600_000, version: 1 },
  protectedUsk: { v: 1, alg: "AES-256-GCM", nonce, ct },
  recoveryProtectedUsk: { v: 1, alg: "AES-256-GCM", nonce, ct },
  recoverySalt: b64(),
  authHash: b64(),
  recoveryAuth: b64(),
};

describe("kdf/params", () => {
  it("accepts valid pbkdf2 params", () => {
    expect(kdfParamsSchema.parse(validRegister.kdf)).toEqual(validRegister.kdf);
  });

  it("rejects unknown kdf kinds", () => {
    expect(() =>
      kdfParamsSchema.parse({ ...validRegister.kdf, kdf: "argon2id" }),
    ).toThrow();
  });

  it("rejects non-base64 salt", () => {
    expect(() =>
      kdfParamsSchema.parse({ ...validRegister.kdf, salt: "not base64!" }),
    ).toThrow();
  });

  it("paramsResponse carries recovery salt", () => {
    const res = paramsResponseSchema.parse({
      kdf: validRegister.kdf,
      recoverySalt: b64(),
    });
    expect(b2i(res.recoverySalt)).toHaveLength(32);
  });
});

describe("login", () => {
  it("accepts ok state", () => {
    expect(
      loginResponseSchema.parse({
        status: "ok",
        token: "t".repeat(32),
        expiresAt: 1,
      }),
    ).toEqual({ status: "ok", token: "t".repeat(32), expiresAt: 1 });
  });

  it("accepts future mfa_required state", () => {
    expect(
      loginResponseSchema.parse({ status: "mfa_required", challenge: "x" }),
    ).toEqual({ status: "mfa_required", challenge: "x" });
  });

  it("rejects unknown state and short tokens", () => {
    expect(() =>
      loginResponseSchema.parse({ status: "bogus", token: "x" }),
    ).toThrow();
    expect(() =>
      loginResponseSchema.parse({ status: "ok", token: "short", expiresAt: 1 }),
    ).toThrow();
  });
});

describe("register", () => {
  it("accepts a valid registration", () => {
    expect(registerRequestSchema.parse(validRegister)).toEqual(validRegister);
  });

  it("rejects bad email", () => {
    expect(() =>
      registerRequestSchema.parse({ ...validRegister, email: "nope" }),
    ).toThrow();
  });

  it("rejects invalid envelope alg", () => {
    expect(() =>
      registerRequestSchema.parse({
        ...validRegister,
        protectedUsk: { v: 1, alg: "XChaCha20", nonce, ct },
      }),
    ).toThrow();
  });

  it("rejects invalid base64 in proof", () => {
    expect(() =>
      registerRequestSchema.parse({ ...validRegister, authHash: "%%%" }),
    ).toThrow();
  });
});

describe("change-master-password / recover", () => {
  const change = {
    newKdf: validRegister.kdf,
    newProtectedUsk: validRegister.protectedUsk,
    newAuthHash: b64(),
  };

  it("accepts change-master-password", () => {
    expect(changeMasterPasswordRequestSchema.parse(change)).toEqual(change);
  });

  it("accepts recover", () => {
    const recovery = { ...change, recoveryAuth: b64() };
    expect(recoverRequestSchema.parse(recovery)).toEqual(recovery);
  });

  it("rejects recover without recoveryAuth", () => {
    expect(() => recoverRequestSchema.parse(change)).toThrow();
  });
});

describe("vault", () => {
  it("accepts a pull response and applies deleted default", () => {
    const item = {
      id: "abc",
      revision: 3,
      updatedAt: 123,
      ciphertext: b64(64),
    };
    const out = vaultItemSchema.parse(item);
    expect(out.deleted).toBe(false);
    expect(
      vaultPullResponseSchema.parse({ items: [out], cursor: 123 }),
    ).toEqual({
      items: [{ ...item, deleted: false }],
      cursor: 123,
    });
  });

  it("accepts tombstones", () => {
    const item = {
      id: "abc",
      revision: 4,
      updatedAt: 124,
      deleted: true,
      ciphertext: b64(64),
    };
    expect(vaultItemSchema.parse(item)).toEqual(item);
  });

  it("rejects bad revision and base64", () => {
    expect(() =>
      vaultPutRequestSchema.parse({
        id: "a",
        baseRevision: -1,
        ciphertext: b64(),
      }),
    ).toThrow();
    expect(() =>
      vaultPutRequestSchema.parse({
        id: "a",
        baseRevision: 0,
        ciphertext: "@@",
      }),
    ).toThrow();
  });
});
