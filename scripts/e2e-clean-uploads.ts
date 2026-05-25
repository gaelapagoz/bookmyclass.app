import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { config as loadEnvFile } from "dotenv";

loadEnvFile({ path: ".env.e2e", override: true, quiet: true });

const configuredUploadsDir = process.env.UPLOADS_DIR?.trim();
const e2eUploadsDir = path.resolve(configuredUploadsDir || path.join(".local", "e2e-uploads"));

async function main(): Promise<void> {
  if (existsSync(e2eUploadsDir)) {
    await rm(e2eUploadsDir, { recursive: true, force: true });
  }

  // Keep parent path present for deterministic local runs and simple diagnostics.
  await mkdir(e2eUploadsDir, { recursive: true });
  console.info(`[e2e:clean-uploads] cleaned ${e2eUploadsDir}`);
}

void main();

