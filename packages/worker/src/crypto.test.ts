import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  computeVerifier,
  decoySalt,
  sha256Hex,
  timingSafeEqual,
} from "./crypto.js";

describe("bytes <-> base64", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("sha256Hex", () => {
  it("matches the known vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("computeVerifier", () => {
  it("is deterministic for the same pepper and proof", async () => {
    const proof = bytesToBase64(new Uint8Array(32).fill(7));
    const a = await computeVerifier("pepper", proof);
    const b = await computeVerifier("pepper", proof);
    expect(a).toBe(b);
  });

  it("changes with the pepper and with the proof", async () => {
    const proof = bytesToBase64(new Uint8Array(32).fill(7));
    const other = bytesToBase64(new Uint8Array(32).fill(8));
    const base = await computeVerifier("pepper", proof);
    expect(await computeVerifier("other-pepper", proof)).not.toBe(base);
    expect(await computeVerifier("pepper", other)).not.toBe(base);
  });
});

describe("decoySalt", () => {
  it("is stable, 16 bytes, and kind-scoped", async () => {
    const salt = await decoySalt("pepper", "a@example.com", "salt");
    expect(salt).toBe(await decoySalt("pepper", "a@example.com", "salt"));
    expect(base64ToBytes(salt)).toHaveLength(16);
    expect(await decoySalt("pepper", "a@example.com", "recovery")).not.toBe(
      salt,
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares equal strings and rejects mismatches", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
