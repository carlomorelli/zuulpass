import { createCipheriv, pbkdf2Sync } from "node:crypto";
import type { Envelope } from "@zuulpass/api-types";
import { describe, expect, it } from "vitest";
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  hkdf,
  pbkdf2,
  utf8ToBytes,
} from "./index.js";

const fromHex = (s: string): Uint8Array =>
  new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("bytes helpers", () => {
  it("round-trips hex through base64 and back", () => {
    const bytes = fromHex("00010203fefdff");
    expect(toHex(base64ToBytes(bytesToBase64(bytes)))).toBe("00010203fefdff");
  });

  it("handles empty input", () => {
    const bytes = new Uint8Array(0);
    expect(bytesToBase64(bytes)).toBe("");
    expect(base64ToBytes("").length).toBe(0);
  });

  it("round-trips UTF-8 including multibyte code points", () => {
    const s = "héllo 🌍 日本語";
    expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
  });
});

describe("PBKDF2-HMAC-SHA256", () => {
  const password = "password";
  const salt = utf8ToBytes("salt");

  // Known-answer vectors (RFC 6070-style families for SHA-256).
  it("matches the c=1 known answer", async () => {
    const out = await pbkdf2(password, salt, 1);
    expect(toHex(out)).toBe(
      "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
    );
  });

  it("matches the c=2 known answer", async () => {
    const out = await pbkdf2(password, salt, 2);
    expect(toHex(out)).toBe(
      "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
    );
  });

  it("matches the c=4096 known answer", async () => {
    const out = await pbkdf2(password, salt, 4096);
    expect(toHex(out)).toBe(
      "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
    );
  });

  it("agrees with node:crypto pbkdf2Sync", async () => {
    for (const c of [1, 2, 4096]) {
      const ours = await pbkdf2(password, salt, c);
      const theirs = pbkdf2Sync(password, salt, c, 32, "sha256");
      expect(toHex(ours)).toBe(theirs.toString("hex"));
    }
  });

  it("derives 32 bytes by default", async () => {
    const out = await pbkdf2(password, salt, 16);
    expect(out.length).toBe(32);
  });
});

describe("HKDF-SHA256 (RFC 5869)", () => {
  it("passes Test Case 1 (non-empty salt and info)", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const salt = fromHex("000102030405060708090a0b0c");
    const info = fromHex("f0f1f2f3f4f5f6f7f8f9");
    const okm = await hkdf(ikm, salt, info, 42);
    expect(toHex(okm)).toBe(
      "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865",
    );
  });

  it("passes Test Case 4 (empty salt and info)", async () => {
    const ikm = new Uint8Array(22).fill(0x0b);
    const okm = await hkdf(ikm, new Uint8Array(0), "", 42);
    expect(toHex(okm)).toBe(
      "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
    );
  });
});

describe("AES-256-GCM envelope", () => {
  const key = new Uint8Array(32).fill(0x42);
  const iv = new Uint8Array(12).fill(0x24);
  const plaintext = utf8ToBytes("attack at dawn — everything is fine");

  it("produces a valid envelope and round-trips", async () => {
    const env = await aesGcmEncrypt(key, plaintext, iv);
    expect(env.v).toBe(1);
    expect(env.alg).toBe("AES-256-GCM");
    expect(env.nonce).toBe(bytesToBase64(iv));
    const decrypted = await aesGcmDecrypt(key, env);
    expect(bytesToUtf8(decrypted)).toBe(bytesToUtf8(plaintext));
  });

  it("matches node:crypto aes-256-gcm (ciphertext||tag)", async () => {
    const env = await aesGcmEncrypt(key, plaintext, iv);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    expect(toHex(base64ToBytes(env.ct))).toBe(enc.toString("hex"));
  });

  it("rejects the wrong key", async () => {
    const env = await aesGcmEncrypt(key, plaintext, iv);
    const wrongKey = key.slice();
    wrongKey[0] = (wrongKey[0] ?? 0) ^ 0xff;
    await expect(aesGcmDecrypt(wrongKey, env)).rejects.toThrow(
      "decryption failed",
    );
  });

  it("detects tampered ciphertext", async () => {
    const env = await aesGcmEncrypt(key, plaintext, iv);
    const tampered = base64ToBytes(env.ct);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    await expect(
      aesGcmDecrypt(key, { ...env, ct: bytesToBase64(tampered) }),
    ).rejects.toThrow("decryption failed");
  });

  it("rejects a wrong-size key and nonce", async () => {
    await expect(
      aesGcmEncrypt(new Uint8Array(16).fill(1), plaintext),
    ).rejects.toThrow("32-byte key");
    await expect(
      aesGcmEncrypt(key, plaintext, new Uint8Array(8)),
    ).rejects.toThrow("12-byte nonce");
  });

  it("rejects unsupported envelope metadata", async () => {
    const env = await aesGcmEncrypt(key, plaintext, iv);
    const bad = { ...env, alg: "AES-128-GCM" } as unknown as Envelope;
    await expect(aesGcmDecrypt(key, bad)).rejects.toThrow(
      "unsupported envelope",
    );
  });
});
