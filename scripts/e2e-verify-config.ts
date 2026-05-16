/**
 * E2e verify config
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/e2e-verify-config.ts
 */
export type RequiredE2EEnv = {
  name: string;
  description: string;
};

export type E2EConfigVerificationResult = {
  ok: boolean;
  missing: string[];
};

export const REQUIRED_E2E_ENV: readonly RequiredE2EEnv[] = [
  { name: "E2E_TEST_SECRET", description: "E2E test secret (non-empty)" },
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR", description: "Store gift card EUR 25 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR", description: "Store gift card EUR 50 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR", description: "Store gift card EUR 100 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT", description: "Store merch yoga mat Stripe price ID" },
  {
    name: "STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS",
    description: "Store merch resistance bands Stripe price ID",
  },
  { name: "STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE", description: "Store merch studio tote Stripe price ID" },
];

function checkRequirement(env: NodeJS.ProcessEnv, requirement: RequiredE2EEnv): boolean {
  const value = env[requirement.name]?.trim();
  return Boolean(value);
}

export function verifyE2EConfig(env: NodeJS.ProcessEnv = process.env): E2EConfigVerificationResult {
  const missing = REQUIRED_E2E_ENV.flatMap((requirement) => {
    if (checkRequirement(env, requirement)) {
      return [];
    }

    return [`  MISSING: ${requirement.name} - ${requirement.description}`];
  });

  return { ok: missing.length === 0, missing };
}

function main(): void {
  const result = verifyE2EConfig();

  if (!result.ok) {
    console.error("\n[verify-e2e-config] E2E configuration is incomplete. npm run test:e2e cannot proceed.\n");
    console.error("The following required env vars are missing or not set correctly:");
    for (const missing of result.missing) {
      console.error(missing);
    }
    console.error("\nSee .env.e2e.example for the full list of required vars.\n");
    process.exit(1);
  }

  console.log("[verify-e2e-config] All required E2E env vars are present. Proceeding.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
import { pathToFileURL } from "node:url";
