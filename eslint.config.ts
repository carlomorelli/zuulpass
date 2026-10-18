import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.wrangler/**",
    "**/*.d.ts",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Always require braces around control-flow bodies (see AGENTS.md).
      curly: ["error", "all"],
      // Allow `_`-prefixed unused params (e.g. Worker fetch(request)).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: {
      // Public (exported) classes, interfaces, types, methods and functions must
      // carry a JSDoc block (see AGENTS.md "Comments & documentation").
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            ClassExpression: false,
            FunctionDeclaration: true,
            FunctionExpression: false,
            MethodDefinition: true,
          },
          contexts: [
            "TSInterfaceDeclaration",
            "TSTypeAliasDeclaration",
            "TSEnumDeclaration",
          ],
          exemptEmptyConstructors: true,
          exemptEmptyFunctions: true,
        },
      ],
      // Methods/functions document inputs and outputs, including failures.
      "jsdoc/require-param": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/require-throws": "error",
    },
  },
  prettierConfig,
);
