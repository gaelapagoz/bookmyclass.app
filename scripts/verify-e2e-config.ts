const REQUIRED_FLAGS: Array<{ name: string; description: string }> = [
  { name: "E2E_TEST_SECRET", description: "E2E test secret (non-empty)" },
];

const REQUIRED_STRIPE_PRICES: Array<{ name: string; description: string }> = [
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR", description: "Store gift card €25 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR", description: "Store gift card €50 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR", description: "Store gift card €100 Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT", description: "Store merch yoga mat Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS", description: "Store merch resistance bands Stripe price ID" },
  { name: "STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE", description: "Store merch studio tote Stripe price ID" },
];

function checkNonEmpty(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

const missing: string[] = [];

for (const { name, description } of REQUIRED_FLAGS) {
  if (!checkNonEmpty(name)) {
    missing.push(`  MISSING: ${name} — ${description}`);
  }
}

for (const { name, description } of REQUIRED_STRIPE_PRICES) {
  if (!checkNonEmpty(name)) {
    missing.push(`  MISSING: ${name} — ${description}`);
  }
}

if (missing.length > 0) {
  console.error("\n[verify-e2e-config] E2E configuration is incomplete. npm run test:e2e cannot proceed.\n");
  console.error("The following required env vars are missing or not set correctly:");
  for (const m of missing) {
    console.error(m);
  }
  console.error("\nSee .env.e2e.example for the full list of required vars.\n");
  process.exit(1);
}

console.log("[verify-e2e-config] All required E2E env vars are present. Proceeding.");
