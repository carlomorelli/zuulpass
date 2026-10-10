import { pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { envelopeSchema } from "@zuulpass/api-types";
import { toHex } from "../test/crypto-helpers.js";
import {
  base64ToBytes,
  bytesToBase64,
  DEFAULT_KDF_ITERATIONS,
  deriveKeys,
  generateKdfParams,
  generateUSK,
  unwrapUSK,
  wrapUSK,
} from "./index.js";

describe("key hierarchy", () => {
  it("derives the same keys from the same password and params", async () => {
    const kdf = generateKdfParams();
    const a = await deriveKeys("correct horse battery staple", kdf);
    const b = await deriveKeys("correct horse battery staple", kdf);
    expect(toHex(a.authHash)).toBe(toHex(b.authHash));
    expect(toHex(a.stretchedKey)).toBe(toHex(b.stretchedKey));
    expect(toHex(a.masterKey)).toBe(toHex(b.masterKey));
  });

  it("changes the auth hash when the password changes", async () => {
    const kdf = generateKdfParams();
    const a = await deriveKeys("password-one", kdf);
    const b = await deriveKeys("password-two", kdf);
    expect(toHex(a.authHash)).not.toBe(toHex(b.authHash));
    expect(toHex(a.stretchedKey)).not.toBe(toHex(b.stretchedKey));
  });

  it("produces a distinct auth hash and stretched key", async () => {
    const derived = await deriveKeys("some password", generateKdfParams());
    expect(derived.authHash.length).toBe(32);
    expect(derived.stretchedKey.length).toBe(32);
    expect(toHex(derived.authHash)).not.toBe(toHex(derived.stretchedKey));
  });

  it("matches OpenSSL for the production 600k iteration count", async () => {
    const kdf = generateKdfParams();
    const { masterKey } = await deriveKeys("hunter2-is-a-bad-password", kdf);
    const openssl = pbkdf2Sync(
      "hunter2-is-a-bad-password",
      base64ToBytes(kdf.salt),
      DEFAULT_KDF_ITERATIONS,
      32,
      "sha256",
    );
    expect(toHex(masterKey)).toBe(openssl.toString("hex"));
  });

  it("generates random 32-byte USKs", () => {
    const usk = generateUSK();
    expect(usk.length).toBe(32);
    expect(toHex(generateUSK())).not.toBe(toHex(usk));
  });

  it("wraps and unwraps the USK and validates the envelope", async () => {
    const kdf = generateKdfParams();
    const { stretchedKey } = await deriveKeys("vault password", kdf);
    const usk = generateUSK();
    const protectedUsk = await wrapUSK(usk, stretchedKey);
    expect(envelopeSchema.safeParse(protectedUsk).success).toBe(true);
    expect(bytesToBase64(await unwrapUSK(protectedUsk, stretchedKey))).toBe(
      bytesToBase64(usk),
    );
  });

  it("fails to unwrap with the wrong stretched key", async () => {
    const kdf = generateKdfParams();
    const { stretchedKey } = await deriveKeys("vault password", kdf);
    const other = await deriveKeys("a different password", kdf);
    const protectedUsk = await wrapUSK(generateUSK(), stretchedKey);
    await expect(unwrapUSK(protectedUsk, other.stretchedKey)).rejects.toThrow(
      "decryption failed",
    );
  });

  it("runs the full production flow at 600k iterations", async () => {
    const kdf = generateKdfParams();
    const { stretchedKey } = await deriveKeys("production flow", kdf);
    const usk = generateUSK();
    const protectedUsk = await wrapUSK(usk, stretchedKey);
    expect(toHex(await unwrapUSK(protectedUsk, stretchedKey))).toBe(toHex(usk));
  });
});
