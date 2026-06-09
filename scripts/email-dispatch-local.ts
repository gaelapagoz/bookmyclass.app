import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

import prisma from "../src/lib/db";
import { dispatchEmailAutomationBatch } from "../src/lib/email/email-automation-dispatcher-service";
import { isRealEmailDeliveryEnabled } from "../src/lib/email/resend-delivery";
import { enqueueWaitlistNotPromotedNotifications } from "../src/lib/public-booking/waitlist-notification-service";

function requiredLocalEmailVars(): Array<{
  name: string;
  required: boolean;
  value: string | undefined;
}> {
  const realDelivery = isRealEmailDeliveryEnabled();
  return [
    { name: "APP_URL", required: true, value: process.env.APP_URL },
    { name: "EMAIL_FROM", required: true, value: process.env.EMAIL_FROM },
    { name: "RESEND_API_KEY", required: realDelivery, value: process.env.RESEND_API_KEY },
    {
      name: "ALLOW_REAL_EMAILS_IN_NON_PRODUCTION",
      required: process.env.NODE_ENV !== "production",
      value: process.env.ALLOW_REAL_EMAILS_IN_NON_PRODUCTION,
    },
    { name: "CRON_SECRET", required: false, value: process.env.CRON_SECRET },
  ];
}

async function main(): Promise<void> {
  const pendingBefore = await prisma.emailAutomationEvent.count({
    where: {
      status: {
        in: ["PENDING", "LEASED"],
      },
    },
  });

  const envSummary = requiredLocalEmailVars().map((item) => ({
    name: item.name,
    present: Boolean(item.value?.trim()),
    required: item.required,
  }));

  console.log("[email-dispatch-local] environment", {
    nodeEnv: process.env.NODE_ENV ?? "development",
    realDeliveryEnabled: isRealEmailDeliveryEnabled(),
    variables: envSummary,
  });

  const waitlistNotPromoted = await enqueueWaitlistNotPromotedNotifications({ limit: 100 });
  const dispatchResult = await dispatchEmailAutomationBatch({
    workerId: "local-email-dispatch",
    maxEvents: 100,
    leaseMs: 30_000,
  });

  const pendingAfter = await prisma.emailAutomationEvent.count({
    where: {
      status: {
        in: ["PENDING", "LEASED"],
      },
    },
  });

  console.log("[email-dispatch-local] summary", {
    pendingAfter,
    pendingBefore,
    dispatchResult,
    waitlistNotPromoted,
  });
}

main()
  .catch((error: unknown) => {
    console.error("[email-dispatch-local] failed", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
