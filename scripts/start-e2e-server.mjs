import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadEnvFile } from "dotenv";

const envFilePath = resolve(process.cwd(), ".env.e2e");

if (!existsSync(envFilePath)) {
  console.error(`[start:e2e] Missing required env file: ${envFilePath}`);
  process.exit(1);
}

const result = loadEnvFile({ path: envFilePath, override: true, quiet: true });
if (result.error) {
  console.error(`[start:e2e] Failed to load ${envFilePath}: ${result.error.message}`);
  process.exit(1);
}

if (!process.env.UPLOADS_DIR?.trim()) {
  process.env.UPLOADS_DIR = resolve(process.cwd(), ".local", "e2e-uploads");
}

const requiredEnvVars = [
  "DATABASE_URL",
  "APP_URL",
  "AUTH_URL",
  "NEXTAUTH_URL",
  "PORT",
  "E2E_TEST_MODE",
  "E2E_TEST_SECRET",
];

const missing = requiredEnvVars.filter((key) => !process.env[key]?.trim());
if (missing.length > 0) {
  console.error(`[start:e2e] Missing required .env.e2e values: ${missing.join(", ")}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL.toLowerCase().includes("e2e")) {
  console.error("[start:e2e] Refusing to start: DATABASE_URL must point at an E2E database.");
  process.exit(1);
}

const port = process.env.PORT;
const appUrl = new URL(process.env.APP_URL);
const expectedOrigin = `http://127.0.0.1:${port}`;
const acceptedOrigins = new Set([expectedOrigin, `http://localhost:${port}`]);

if (!acceptedOrigins.has(appUrl.origin)) {
  console.error(`[start:e2e] APP_URL must be ${expectedOrigin} or http://localhost:${port}. Got ${appUrl.origin}.`);
  process.exit(1);
}

for (const key of ["AUTH_URL", "NEXTAUTH_URL"]) {
  const origin = new URL(process.env[key]).origin;
  if (origin !== appUrl.origin) {
    console.error(`[start:e2e] ${key} must match APP_URL origin ${appUrl.origin}. Got ${origin}.`);
    process.exit(1);
  }
}

const nextBin = resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (!child.killed) {
    child.kill(signal);
  }

  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5_000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
