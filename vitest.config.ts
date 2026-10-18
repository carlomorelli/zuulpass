import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "node",
    include: ["packages/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "packages/integration-tests/**"],
    passWithNoTests: true,
  },
});
