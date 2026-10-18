import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { confirm, input, password as passwordPrompt } from "@inquirer/prompts";
import {
  assessMasterPassword,
  bytesToBase64,
  createApiClient,
  createLoginItem,
  deriveKeys,
  deriveRecoveryAuth,
  generateKdfParams,
  generateRecoveryKey,
  generateRecoverySalt,
  generateUSK,
  loadCache,
  loadConfig,
  register,
  saveCache,
  saveConfig,
  saveParams,
  unlock,
  wrapUSK,
  wrapUSKWithRecovery,
  zuulpassHome,
  type LocalVaultItem,
} from "@zuulpass/core";

interface CommonOptions {
  passwordStdin?: boolean;
}

interface InitOptions extends CommonOptions {
  email?: string;
  server?: string;
}

interface AddOptions extends CommonOptions {
  name?: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
}

const DEFAULT_SERVER = "http://127.0.0.1:8787";

function fail(message: string): never {
  console.error(`zuulp: ${message}`);
  process.exit(1);
}

// `--password-stdin` (or a piped stdin) means "scripted run": no interactive
// prompts. Required values must be passed as flags; optional ones default to
// empty instead of crashing the prompt library.
function nonInteractive(opts: CommonOptions): boolean {
  return Boolean(opts.passwordStdin) || !process.stdin.isTTY;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

async function readMasterPassword(opts: CommonOptions): Promise<string> {
  if (opts.passwordStdin) {
    return readStdin();
  }
  return passwordPrompt({ message: "Master password", mask: true });
}

async function readNewMasterPassword(opts: CommonOptions): Promise<string> {
  if (opts.passwordStdin) {
    const value = await readStdin();
    const assessment = assessMasterPassword(value);
    if (!assessment.acceptable) {
      fail(
        `master password too weak (score ${assessment.score}/4). ${assessment.feedback}`,
      );
    }
    return value;
  }
  for (;;) {
    const value = await passwordPrompt({
      message: "Master password",
      mask: true,
    });
    const assessment = assessMasterPassword(value);
    if (!assessment.acceptable) {
      console.log(
        `Too weak (score ${assessment.score}/4). ${assessment.feedback}`,
      );
      continue;
    }
    const again = await passwordPrompt({
      message: "Confirm master password",
      mask: true,
    });
    if (again !== value) {
      console.log("Passwords do not match.");
      continue;
    }
    return value;
  }
}

async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

const program = new Command();

program
  .name("zuulp")
  .description("ZuulPass zero-knowledge password manager CLI")
  .version("0.1.0");

program
  .command("init")
  .description("create an account and print a recovery code once")
  .option("--email <email>", "account email")
  .option("--server <url>", `server URL (default ${DEFAULT_SERVER})`)
  .option("--password-stdin", "read the master password from stdin")
  .action((opts: InitOptions) =>
    runAction(async () => {
      const home = zuulpassHome();
      const email =
        opts.email ??
        (nonInteractive(opts)
          ? fail("--email is required when stdin is piped")
          : await input({
              message: "Email",
              validate: (value) => value.includes("@") || "enter a valid email",
            }));
      const serverUrl = opts.server ?? DEFAULT_SERVER;
      const masterPassword = await readNewMasterPassword(opts);

      const kdf = generateKdfParams();
      const { authHash, stretchedKey } = await deriveKeys(masterPassword, kdf);
      const usk = generateUSK();
      const protectedUsk = await wrapUSK(usk, stretchedKey);

      const { recoveryKey, recoveryCode } = generateRecoveryKey();
      const recoverySalt = generateRecoverySalt();
      const recoveryProtectedUsk = await wrapUSKWithRecovery(
        usk,
        recoveryKey,
        recoverySalt,
      );
      const recoveryAuth = await deriveRecoveryAuth(recoveryKey, recoverySalt);

      const client = createApiClient(serverUrl);
      await register(client, {
        email,
        kdf,
        protectedUsk,
        recoveryProtectedUsk,
        recoverySalt: bytesToBase64(recoverySalt),
        authHash: bytesToBase64(authHash),
        recoveryAuth: bytesToBase64(recoveryAuth),
      });

      await saveConfig({ serverUrl, email }, home);
      await saveParams(
        { kdf, recoverySalt: bytesToBase64(recoverySalt), protectedUsk },
        home,
      );

      console.log(
        "\nAccount created. Store this recovery code somewhere safe:",
      );
      console.log(`\n    ${recoveryCode}\n`);
      if (nonInteractive(opts)) {
        console.log(
          "This is the only way to recover the vault without the master password — keep it safe.",
        );
      } else {
        const saved = await confirm({
          message: "I have saved my recovery code",
          default: false,
        });
        if (!saved) {
          console.log(
            "You can still recover the vault with it later — keep it safe.",
          );
        }
      }
      console.log(`Vault home: ${home}`);
    }),
  );

program
  .command("add")
  .description("add a login item (stored in the local encrypted cache)")
  .option("--name <name>", "item name")
  .option("--username <username>", "username")
  .option("--password <password>", "item password")
  .option("--url <url>", "primary URL")
  .option("--notes <notes>", "notes")
  .option("--password-stdin", "read the master password from stdin")
  .action((opts: AddOptions) =>
    runAction(async () => {
      const home = zuulpassHome();
      const config = await loadConfig(home);
      if (!config) {
        fail("no account configured — run `zuulp init` first");
      }
      const masterPassword = await readMasterPassword(opts);
      const session = await unlock({
        serverUrl: config.serverUrl,
        email: config.email,
        masterPassword,
      });

      const name =
        opts.name ??
        (nonInteractive(opts)
          ? fail("--name is required when stdin is piped")
          : await input({ message: "Item name", validate: Boolean }));
      const username =
        opts.username ??
        (nonInteractive(opts)
          ? ""
          : await input({ message: "Username", default: "" }));
      const itemPassword =
        opts.password ??
        (nonInteractive(opts)
          ? ""
          : await passwordPrompt({ message: "Item password", mask: true }));
      const url =
        opts.url ??
        (nonInteractive(opts)
          ? ""
          : await input({ message: "URL", default: "" }));
      const notes =
        opts.notes ??
        (nonInteractive(opts)
          ? ""
          : await input({ message: "Notes", default: "" }));

      const cache = await loadCache(home, session.usk);
      const item: LocalVaultItem = {
        id: randomUUID(),
        payload: createLoginItem({
          name,
          username,
          password: itemPassword,
          urls: url ? [{ url, match: "host" }] : [],
          notes,
        }),
      };
      cache.items.push(item);
      await saveCache(home, session.usk, cache);
      console.log(`Added "${name}" (${cache.items.length} items in vault).`);
    }),
  );

program
  .command("ls")
  .description("list vault items")
  .option("--password-stdin", "read the master password from stdin")
  .action((opts: CommonOptions) =>
    runAction(async () => {
      const home = zuulpassHome();
      const config = await loadConfig(home);
      if (!config) {
        fail("no account configured — run `zuulp init` first");
      }
      const masterPassword = await readMasterPassword(opts);
      const session = await unlock({
        serverUrl: config.serverUrl,
        email: config.email,
        masterPassword,
      });
      const cache = await loadCache(home, session.usk);
      if (cache.items.length === 0) {
        console.log("Vault is empty.");
        return;
      }
      for (const item of cache.items) {
        const url = item.payload.urls[0]?.url ?? "";
        console.log(`${item.payload.name}\t${item.payload.username}\t${url}`);
      }
    }),
  );

await program.parseAsync(process.argv);
