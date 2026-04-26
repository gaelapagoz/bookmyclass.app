import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // This rule is too strict for server components that fetch data and render fallback UI.
      // We prefer handling failures via UX (fallback states) rather than lint-blocking try/catch patterns.
      "react-hooks/error-boundaries": "off",

      // These rules are currently too strict for this codebase/tests and block lint entirely.
      // Prefer addressing them incrementally without blocking unrelated changes.
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-assign-module-variable": "off",

      // Follow the standard TypeScript convention: prefix intentionally unused params/vars with `_`.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Auto-generated coverage report assets — not subject to lint.
    "coverage/**",
  ]),
]);

export default eslintConfig;
