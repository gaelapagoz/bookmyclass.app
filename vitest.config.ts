import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "next/server": "next/server.js",
    },
  },
  test: {
    environment: "node",
    globals: true,
    fileParallelism: false,
    exclude: [...configDefaults.exclude, "test/e2e/**"],

    // 👇 ADD THIS
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