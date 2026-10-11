import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Envelope } from "@zuulpass/api-types";
import { bytesToUtf8, utf8ToBytes } from "./bytes.js";
import { CACHE_FILE } from "./config.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto.js";
import type { LocalVaultItem } from "./vault-item.js";

// Single USK-encrypted local cache file (docs/architecture.md §16).
export const CACHE_VERSION = 1;

export interface CacheContents {
  version: number;
  items: LocalVaultItem[];
}

export function emptyCache(): CacheContents {
  return { version: CACHE_VERSION, items: [] };
}

export function encryptCache(
  usk: Uint8Array,
  cache: CacheContents,
): Promise<Envelope> {
  return aesGcmEncrypt(usk, utf8ToBytes(JSON.stringify(cache)));
}

export async function decryptCache(
  usk: Uint8Array,
  envelope: Envelope,
): Promise<CacheContents> {
  const parsed = JSON.parse(bytesToUtf8(await aesGcmDecrypt(usk, envelope))) as
    CacheContents | undefined;
  if (typeof parsed?.version !== "number" || !Array.isArray(parsed.items)) {
    throw new Error("corrupt local cache");
  }
  return parsed;
}

export async function loadCache(
  home: string,
  usk: Uint8Array,
): Promise<CacheContents> {
  let raw: string;
  try {
    raw = await readFile(join(home, CACHE_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyCache();
    throw err;
  }
  return decryptCache(usk, JSON.parse(raw) as Envelope);
}

export async function saveCache(
  home: string,
  usk: Uint8Array,
  cache: CacheContents,
): Promise<void> {
  const path = join(home, CACHE_FILE);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(await encryptCache(usk, cache))}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}
