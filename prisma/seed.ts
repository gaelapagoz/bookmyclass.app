import prisma from "../src/lib/db";
import { resolveSeedMode, validateEnvironmentForMode } from "./seed/config";
import { runDevelopmentSeed } from "./seed/modes/development";
import { runUatPerformanceSeed } from "./seed/modes/uat-performance";
import { runProductionSeed } from "./seed/modes/production";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");

  const mode = resolveSeedMode();
  validateEnvironmentForMode(mode, databaseUrl);

  switch (mode) {
    case "development":
      await runDevelopmentSeed();
      return;
    case "uat-performance":
      await runUatPerformanceSeed();
      return;
    case "production":
      await runProductionSeed();
      return;
    default: {
      const neverMode: never = mode;
      throw new Error(`Unhandled seed mode: ${neverMode}`);
    }
  }
}

main()
  .catch((err) => {
    console.error("[seed] Failed.", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

