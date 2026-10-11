import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  loadParams,
  saveConfig,
  saveParams,
  zuulpassHome,
} from "./config.js";
import { aesGcmEncrypt, randomBytes } from "./crypto.js";
import { generateKdfParams } from "./kdf.js";

describe("zuulpassHome", () => {
  it("honours the ZUULPASS_HOME override", () => {
    expect(
      zuulpassHome({ ZUULPASS_HOME: "C:\\custom\\zuulp" } as NodeJS.ProcessEnv),
    ).toBe("C:\\custom\\zuulp");
  });

  it("falls back to a zuulpass directory", () => {
    expect(zuulpassHome({} as NodeJS.ProcessEnv)).toMatch(/zuulpass$/);
  });
});

describe("client state files", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "zuulpass-config-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("returns null when no config exists, then round-trips", async () => {
    expect(await loadConfig(home)).toBeNull();
    const config = { serverUrl: "http://localhost:8787", email: "a@b.co" };
    await saveConfig(config, home);
    expect(await loadConfig(home)).toEqual(config);
  });

  it("round-trips cached params", async () => {
    expect(await loadParams(home)).toBeNull();
    const encrypted = await aesGcmEncrypt(randomBytes(32), randomBytes(16));
    const params = {
      kdf: generateKdfParams(),
      recoverySalt: "AAAAAAAAAAAAAAAAAAAAAA==",
      protectedUsk: encrypted,
    };
    await saveParams(params, home);
    expect(await loadParams(home)).toEqual(params);
  });
});
