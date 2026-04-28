import { defineConfig } from "@playwright/test";

const demoBaseUrl = process.env.DEMO_BASE_URL ?? "https://uat.bookmyclass.app";

export default defineConfig({
  testDir: "./test/manual/demo-screenshots",
  timeout: 60_000,
  fullyParallel: false,
  retries: 1,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: demoBaseUrl,
    trace: "retain-on-failure",
  },
  outputDir: "artifacts/demo-screenshots/traces",
  reporter: [
    ["list"],
    ["html", { outputFolder: "artifacts/demo-screenshots/report", open: "never" }],
  ],
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
