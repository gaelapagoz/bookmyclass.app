import "dotenv/config";

import prisma from "../src/lib/db";
import { verifyEmailPlatformReadiness } from "../src/lib/readiness/email-platform-readiness";

async function main(): Promise<void> {
  const readiness = await verifyEmailPlatformReadiness(process.env);

  if (!readiness.ok) {
    for (const blocker of readiness.blockers) {
      console.error(`[email-verify] blocker: ${blocker}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("[email-verify] ok");
}

main()
  .catch((error: unknown) => {
    console.error("[email-verify] failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
