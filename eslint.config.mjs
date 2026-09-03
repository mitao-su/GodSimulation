import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".workbuddy/**",
      ".worktrees/**",
      "**/dist/**",
      "**/dist-types/**",
      "**/coverage/**",
      "data/**",
      "playwright-report/**",
      "private/**",
      "test-results/**",
      "workspace/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
  },
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        clearTimeout: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { "fixStyle": "inline-type-imports" }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Inner simulation layers must depend on the narrow operation runtime
    // registry protocol, never on the engine composition root. ESLint
    // covers type-only imports, which dependency-cruiser cannot see.
    files: [
      "packages/simulation/src/execution/**/*.ts",
      "packages/simulation/src/decision/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/engine/simulation-registry"],
              message:
                "Depend on the narrow OperationRuntimeRegistry protocol from execution/operation-runtime instead of the engine composition root.",
            },
          ],
        },
      ],
    },
  },
);
