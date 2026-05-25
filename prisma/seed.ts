import prisma from "../src/lib/db";
import { verifySeedDataPreflight } from "../src/lib/readiness/legacy-contract-guardrails";
import { resolveSeedMode, validateEnvironmentForMode } from "./seed/config";
import { runDevelopmentSeed } from "./seed/modes/development";
import { runDemoSeed } from "./seed/modes/demo";
import { runProductionSeed } from "./seed/modes/production";
import { runStagingSeed } from "./seed/modes/staging";
import type { SeedMode } from "./seed/config";

export const seedModeRunners: Record<SeedMode, () => Promise<void>> = {
  development: runDevelopmentSeed,
  staging: runStagingSeed,
  demo: runDemoSeed,
  production: runProductionSeed,
};

export async function runSeedForMode(mode: SeedMode): Promise<void> {
  const runner = seedModeRunners[mode];
  await runner();
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const mode = resolveSeedMode();
  validateEnvironmentForMode(mode, databaseUrl);
  verifySeedDataPreflight(mode);

  await runSeedForMode(mode);
}

function isExecutedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  const normalizedEntry = entry.replaceAll("\\", "/");
  return normalizedEntry.endsWith("/prisma/seed.ts");
}

if (isExecutedDirectly()) {
  main()
    .catch((err) => {
      console.error("[seed] Failed.", err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}


