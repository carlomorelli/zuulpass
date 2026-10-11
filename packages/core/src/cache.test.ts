import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptCache,
  emptyCache,
  encryptCache,
  loadCache,
  saveCache,
} from "./cache.js";
import { randomBytes } from "./crypto.js";
import { createLoginItem } from "./vault-item.js";

const usk = randomBytes(32);

describe("cache encryption", () => {
  it("round-trips items under the USK", async () => {
    const cache = emptyCache();
    cache.items.push({
      id: "item-1",
      payload: createLoginItem({ name: "github", username: "octocat" }),
    });
    const envelope = await encryptCache(usk, cache);
    expect(await decryptCache(usk, envelope)).toEqual(cache);
  });

  it("fails to decrypt with the wrong key", async () => {
    const envelope = await encryptCache(usk, emptyCache());
    await expect(decryptCache(randomBytes(32), envelope)).rejects.toThrow();
  });
});

describe("cache file", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "zuulpass-cache-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("treats a missing file as an empty cache", async () => {
    expect(await loadCache(home, usk)).toEqual(emptyCache());
  });

  it("saves and reloads items", async () => {
    const cache = emptyCache();
    cache.items.push({
      id: "item-1",
      payload: createLoginItem({ name: "email", password: "hunter2" }),
    });
    await saveCache(home, usk, cache);
    expect(await loadCache(home, usk)).toEqual(cache);
  });
});
