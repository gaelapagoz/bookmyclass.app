/**
 * Provisions all canonical email automation templates into the database.
 *
 * Missing templates are created active by default. Existing templates keep their
 * current Active/Paused status and customized content, except placeholder
 * bootstrap bodies may be filled from canonical defaults.
 *
 * Run with: npm run email:provision-templates
 */

import prisma from "../src/lib/db";
import { ensureAllExpectedAutomationTemplatesExist } from "../src/lib/email/email-automation-admin-service";

async function provisionEmailTemplates(): Promise<void> {
  console.log("Ensuring all canonical email automation templates exist...");
  await ensureAllExpectedAutomationTemplatesExist();
  console.log("Done. Missing templates were created as active; existing statuses were preserved.");
}

provisionEmailTemplates()
  .catch((error) => {
    console.error("Provision failed:", error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
