import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
    alias: [
      { find: "@", replacement: resolve(process.cwd(), "src") },
      { find: "next/server", replacement: resolve(process.cwd(), "node_modules/next/server.js") },
      { find: "next/navigation", replacement: resolve(process.cwd(), "test/stubs/next-navigation.ts") },
      { find: "@sentry/nextjs", replacement: resolve(process.cwd(), "test/stubs/sentry-nextjs.ts") },
      { find: "next-auth/providers/credentials", replacement: resolve(process.cwd(), "test/stubs/next-auth-credentials.ts") },
      { find: "next-auth/react", replacement: resolve(process.cwd(), "test/stubs/next-auth-react.ts") },
      { find: "next-auth", replacement: resolve(process.cwd(), "test/stubs/next-auth.ts") },
      { find: "vitest", replacement: resolve(process.cwd(), "test/vitest-shim.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    setupFiles: ["./test/setup-env.ts"],
    exclude: [...configDefaults.exclude, "test/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        ...configDefaults.exclude,
        "test/**",
        "scripts/**",
        "k6/**",
      ],
    },
  },
});
