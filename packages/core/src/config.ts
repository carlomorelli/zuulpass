import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Envelope, KdfParams } from "@zuulpass/api-types";

/** Client state files (docs/architecture.md §8). */
export interface ClientConfig {
  serverUrl: string;
  email: string;
}

/**
 * Non-secret KDF params + the wrapped USK, so the local cache can be unlocked
 * offline once the Stretched Key is derived from the master password.
 */
export interface CachedParams {
  kdf: KdfParams;
  recoverySalt: string;
  protectedUsk: Envelope;
}

export const CONFIG_FILE = "config.json";
export const PARAMS_FILE = "params.json";
export const CACHE_FILE = "cache.enc";

/**
 * Resolve the ZuulPass home directory (`ZUULPASS_HOME`, else a platform default).
 * @param env - Environment to read (defaults to `process.env`).
 * @returns The resolved home directory path.
 */
export function zuulpassHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ZUULPASS_HOME?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    return join(
      env.APPDATA ?? join(homedir(), "AppData", "Roaming"),
      "zuulpass",
    );
  }
  return join(homedir(), ".config", "zuulpass");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/**
 * Load the local client config.
 * @param home - The ZuulPass home directory.
 * @returns The config, or `null` if none exists.
 */
export function loadConfig(
  home = zuulpassHome(),
): Promise<ClientConfig | null> {
  return readJson<ClientConfig>(join(home, CONFIG_FILE));
}

/**
 * Persist the local client config.
 * @param config - The config to save.
 * @param home - The ZuulPass home directory.
 * @returns A promise that resolves once the config is written.
 */
export function saveConfig(
  config: ClientConfig,
  home = zuulpassHome(),
): Promise<void> {
  return writeJson(join(home, CONFIG_FILE), config);
}

/**
 * Load cached KDF params (enables offline unlock).
 * @param home - The ZuulPass home directory.
 * @returns The cached params, or `null` if none exist.
 */
export function loadParams(
  home = zuulpassHome(),
): Promise<CachedParams | null> {
  return readJson<CachedParams>(join(home, PARAMS_FILE));
}

/**
 * Persist cached KDF params.
 * @param params - The params to cache.
 * @param home - The ZuulPass home directory.
 * @returns A promise that resolves once the params are written.
 */
export function saveParams(
  params: CachedParams,
  home = zuulpassHome(),
): Promise<void> {
  return writeJson(join(home, PARAMS_FILE), params);
}
