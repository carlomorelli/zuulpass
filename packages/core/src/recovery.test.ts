import { describe, expect, it } from "vitest";
import { envelopeSchema } from "@zuulpass/api-types";
import { toHex } from "../test/crypto-helpers.js";
import {
  decodeRecoveryCode,
  deriveRecoveryAuth,
  deriveRecoveryWrapKey,
  encodeRecoveryCode,
  generateRecoveryKey,
  generateRecoverySalt,
  unwrapUSKWithRecovery,
  wrapUSKWithRecovery,
} from "./index.js";

describe("recovery code", () => {
  it("encodes the key as a grouped uppercase base32 string", () => {
    const { recoveryCode } = generateRecoveryKey();
    expect(recoveryCode).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){12}$/);
    expect(recoveryCode.replaceAll("-", "")).toHaveLength(52);
  });

  it("round-trips through user-entered variants (case, separators)", () => {
    const { recoveryKey, recoveryCode } = generateRecoveryKey();
    expect(decodeRecoveryCode(recoveryCode)).toEqual(recoveryKey);
    expect(decodeRecoveryCode(recoveryCode.toLowerCase())).toEqual(recoveryKey);
    expect(
      decodeRecoveryCode(recoveryCode.replaceAll("-", " ").toLowerCase()),
    ).toEqual(recoveryKey);
  });

  it("rejects non-base32 input", () => {
    expect(() => decodeRecoveryCode("ABC0-EFGH")).toThrow("not base32");
    expect(() => decodeRecoveryCode("ABC!-EFGH")).toThrow("not base32");
  });

  it("re-encodes decoded input to the canonical form", () => {
    const { recoveryCode } = generateRecoveryKey();
    expect(encodeRecoveryCode(decodeRecoveryCode(recoveryCode))).toBe(
      recoveryCode,
    );
  });
});

describe("recovery wrap key", () => {
  it("is deterministic per (key, salt) and differs on either", async () => {
    const { recoveryKey } = generateRecoveryKey();
    const saltA = generateRecoverySalt();
    const saltB = generateRecoverySalt();
    const other = generateRecoveryKey().recoveryKey;

    const a1 = await deriveRecoveryWrapKey(recoveryKey, saltA);
    const a2 = await deriveRecoveryWrapKey(recoveryKey, saltA);
    expect(toHex(a1)).toBe(toHex(a2));

    const b = await deriveRecoveryWrapKey(recoveryKey, saltB);
    expect(toHex(a1)).not.toBe(toHex(b));

    const c = await deriveRecoveryWrapKey(other, saltA);
    expect(toHex(a1)).not.toBe(toHex(c));
  });

  it("derives a distinct recovery auth proof", async () => {
    const { recoveryKey } = generateRecoveryKey();
    const salt = generateRecoverySalt();
    const auth = await deriveRecoveryAuth(recoveryKey, salt);
    const wrapKey = await deriveRecoveryWrapKey(recoveryKey, salt);
    expect(auth.length).toBe(32);
    expect(toHex(auth)).not.toBe(toHex(wrapKey));
  });
});

describe("USK wrapped under the recovery key", () => {
  it("round-trips and produces server-valid envelopes", async () => {
    const { recoveryKey } = generateRecoveryKey();
    const recoverySalt = generateRecoverySalt();
    const usk = new Uint8Array(32).fill(0x7a);
    const rpUsk = await wrapUSKWithRecovery(usk, recoveryKey, recoverySalt);
    expect(envelopeSchema.safeParse(rpUsk).success).toBe(true);
    expect(
      toHex(await unwrapUSKWithRecovery(rpUsk, recoveryKey, recoverySalt)),
    ).toBe(toHex(usk));
  });

  it("fails with the wrong recovery key or salt", async () => {
    const { recoveryKey } = generateRecoveryKey();
    const recoverySalt = generateRecoverySalt();
    const otherKey = generateRecoveryKey().recoveryKey;
    const otherSalt = generateRecoverySalt();
    const rpUsk = await wrapUSKWithRecovery(
      new Uint8Array(32).fill(3),
      recoveryKey,
      recoverySalt,
    );

    await expect(
      unwrapUSKWithRecovery(rpUsk, otherKey, recoverySalt),
    ).rejects.toThrow("decryption failed");
    await expect(
      unwrapUSKWithRecovery(rpUsk, recoveryKey, otherSalt),
    ).rejects.toThrow("decryption failed");
  });

  it("supports the full recovery flow from a typed-in code", async () => {
    const { recoveryKey, recoveryCode } = generateRecoveryKey();
    const recoverySalt = generateRecoverySalt();
    const usk = new Uint8Array(32).fill(0x11);
    const rpUsk = await wrapUSKWithRecovery(usk, recoveryKey, recoverySalt);

    const typedCode = recoveryCode.toLowerCase().replaceAll("-", " ");
    const decoded = decodeRecoveryCode(typedCode);
    expect(
      toHex(await unwrapUSKWithRecovery(rpUsk, decoded, recoverySalt)),
    ).toBe(toHex(usk));
  });
});
