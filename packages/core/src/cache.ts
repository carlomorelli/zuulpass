import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Envelope } from "@zuulpass/api-types";
import { bytesToUtf8, utf8ToBytes } from "./bytes.js";
import { CACHE_FILE } from "./config.js";
import { aesGcmDecrypt, aesGcmEncrypt } from "./crypto.js";
import type { LocalVaultItem } from "./vault-item.js";

/** Single USK-encrypted local cache file (docs/architecture.md §16). */
export const CACHE_VERSION = 1;

/** In-memory view of the local cache file. */
export interface CacheContents {
  version: number;
  items: LocalVaultItem[];
}

/**
 * Create an empty cache at the current version.
 * @returns An empty `CacheContents`.
 */
export function emptyCache(): CacheContents {
  return { version: CACHE_VERSION, items: [] };
}

/**
 * Encrypt cache contents under the USK.
 * @param usk - The User Symmetric Key.
 * @param cache - The cache contents to encrypt.
 * @returns The AES-GCM envelope to persist.
 */
export function encryptCache(
  usk: Uint8Array,
  cache: CacheContents,
): Promise<Envelope> {
  return aesGcmEncrypt(usk, utf8ToBytes(JSON.stringify(cache)));
}

/**
 * Decrypt cache contents from a stored envelope.
 * @param usk - The User Symmetric Key.
 * @param envelope - The stored cache envelope.
 * @returns The decrypted cache contents.
 * @throws If the envelope does not decrypt or the payload is not a valid cache.
 */
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

/**
 * Load and decrypt the cache file, or return an empty cache if it does not exist.
 * @param home - The ZuulPass home directory.
 * @param usk - The User Symmetric Key.
 * @returns The decrypted cache contents.
 * @throws If the cache file exists but cannot be read, decrypted, or parsed.
 */
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

/**
 * Encrypt and write the cache file with owner-only permissions.
 * @param home - The ZuulPass home directory.
 * @param usk - The User Symmetric Key.
 * @param cache - The cache contents to persist.
 */
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
