/**
 * Stripe Catalog Sync Script
 *
 * Creates or reuses Stripe Products and Prices for all catalog items,
 * then writes the confirmed Stripe Price IDs back to the local DB.
 * DB-driven, idempotent, safe for both test and live Stripe modes.
 *
 * Usage:
 *   npm run stripe:catalog:sync -- --scope=all --dry-run
 *   npm run stripe:catalog:sync -- --scope=all
 *   npm run stripe:catalog:sync -- --scope=store
 *   npm run stripe:catalog:sync -- --scope=plans
 *   npm run stripe:catalog:sync -- --scope=all --confirm-live
 */

// dotenv/config must be the first import so DATABASE_URL is set before db.ts initializes.
import "dotenv/config";
import Stripe from "stripe";
import { BillingInterval, PriceType, ProductType, StripeSyncStatus } from "@prisma/client";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import prisma from "../src/lib/db";

// ── Constants ──────────────────────────────────────────────────────────────────

const STRIPE_API_VERSION = "2025-08-27.basil" as const;

// EUR 500.00 in cents — gift card hard maximum
const GIFT_CARD_MAX_AMOUNT_MINOR = 50_000;

const PLAN_PRODUCT_TYPES = new Set<ProductType>([
  ProductType.DROP_IN_CLASS,
  ProductType.CLASS_PACK,
  ProductType.PRIVATE_PACK,
  ProductType.UNLIMITED_MEMBERSHIP,
]);

const STORE_PRODUCT_TYPES = new Set<ProductType>([
  ProductType.GIFT_CARD,
  ProductType.MERCHANDISE,
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export type StripeMode = "test" | "live";
export type SyncScope = "all" | "plans" | "store";

export type LocalPriceData = {
  id: string;
  lookupKey: string;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  isActive: boolean;
  isArchived: boolean;
  product: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    productType: ProductType;
    isActive: boolean;
    isArchived: boolean;
  };
};

export type StripePriceSnapshot = {
  id: string;
  currency: string;
  unit_amount: number | null;
  type: "one_time" | "recurring";
  product: string;
  recurring: { interval: string; interval_count: number } | null;
  lookup_key: string | null;
};

export type PriceInspectionResult =
  | { found: true; by: "price-id" | "lookup-key"; price: StripePriceSnapshot }
  | { found: false; by: "price-id" | "lookup-key" | "none" };

export type PriceDecision =
  | { decision: "already-synced" }
  | { decision: "reuse"; stripePriceId: string; by: "price-id" | "lookup-key" }
  | { decision: "create" }
  | { decision: "mismatch-error"; reason: string }
  | { decision: "not-found-error"; reason: string }
  | { decision: "validation-error"; reason: string };

type PriceOutcome = {
  priceId: string;
  lookupKey: string;
  productSlug: string;
  productType: ProductType;
  decision: PriceDecision;
  stripeProductId?: string;
  wasProductCreated?: boolean;
  finalStripePriceId?: string;
  wasPriceCreated?: boolean;
  dbUpdated?: boolean;
  error?: string;
};

type SyncSummary = {
  scope: SyncScope;
  dryRun: boolean;
  stripeMode: StripeMode;
  productsInspected: number;
  pricesInspected: number;
  stripeProductsCreated: number;
  stripeProductsReused: number;
  stripePricesCreated: number;
  stripePricesReused: number;
  dbPricesUpdated: number;
  pricesAlreadySynced: number;
  validationErrors: number;
  mismatchErrors: number;
  otherErrors: number;
  outcomes: PriceOutcome[];
};

// ── Pure exported functions (testable without real Stripe) ────────────────────

export function resolveStripeMode(secretKey: string): StripeMode | null {
  if (secretKey.startsWith("sk_live_")) return "live";
  if (secretKey.startsWith("sk_test_")) return "test";
  return null;
}

export function requiresLiveConfirmation(stripeMode: StripeMode, confirmLive: boolean): boolean {
  return stripeMode === "live" && !confirmLive;
}

export function validateStorePrice(price: {
  productType: ProductType;
  currencyCode: string;
  priceType: PriceType;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
}): { valid: boolean; error?: string } {
  if (price.productType === ProductType.GIFT_CARD) {
    if (price.currencyCode !== "EUR") {
      return { valid: false, error: `Gift card must be EUR currency, got ${price.currencyCode}` };
    }
    if (price.priceType !== PriceType.ONE_TIME) {
      return { valid: false, error: "Gift card must be ONE_TIME price type" };
    }
    if (price.billingInterval !== null) {
      return { valid: false, error: "Gift card must not have a billing interval" };
    }
    if (price.unitAmountMinor <= 0) {
      return { valid: false, error: `Gift card amount must be > 0, got ${price.unitAmountMinor}` };
    }
    if (price.unitAmountMinor > GIFT_CARD_MAX_AMOUNT_MINOR) {
      return {
        valid: false,
        error: `Gift card amount ${price.unitAmountMinor} exceeds maximum ${GIFT_CARD_MAX_AMOUNT_MINOR} (EUR 500.00)`,
      };
    }
  }

  if (price.productType === ProductType.MERCHANDISE) {
    if (price.currencyCode !== "EUR") {
      return { valid: false, error: `Merchandise must be EUR currency, got ${price.currencyCode}` };
    }
    if (price.priceType !== PriceType.ONE_TIME) {
      return { valid: false, error: "Merchandise must be ONE_TIME price type" };
    }
  }

  return { valid: true };
}

export function verifyPriceMatch(
  local: Pick<
    LocalPriceData,
    "currencyCode" | "unitAmountMinor" | "priceType" | "billingInterval" | "billingIntervalCount"
  >,
  stripe: StripePriceSnapshot,
): { matches: boolean; mismatch?: string } {
  const expectedCurrency = local.currencyCode.toLowerCase();
  if (stripe.currency !== expectedCurrency) {
    return {
      matches: false,
      mismatch: `currency mismatch: local=${local.currencyCode} stripe=${stripe.currency}`,
    };
  }

  if (stripe.unit_amount !== local.unitAmountMinor) {
    return {
      matches: false,
      mismatch: `amount mismatch: local=${local.unitAmountMinor} stripe=${stripe.unit_amount}`,
    };
  }

  const expectedType = local.priceType === PriceType.ONE_TIME ? "one_time" : "recurring";
  if (stripe.type !== expectedType) {
    return {
      matches: false,
      mismatch: `type mismatch: local=${expectedType} stripe=${stripe.type}`,
    };
  }

  if (local.priceType === PriceType.RECURRING) {
    if (!stripe.recurring) {
      return {
        matches: false,
        mismatch: "stripe price has no recurring config but local price type is RECURRING",
      };
    }
    const expectedInterval = mapBillingIntervalToStripe(local.billingInterval!);
    if (stripe.recurring.interval !== expectedInterval) {
      return {
        matches: false,
        mismatch: `interval mismatch: local=${expectedInterval} stripe=${stripe.recurring.interval}`,
      };
    }
    if (stripe.recurring.interval_count !== local.billingIntervalCount) {
      return {
        matches: false,
        mismatch: `interval_count mismatch: local=${local.billingIntervalCount} stripe=${stripe.recurring.interval_count}`,
      };
    }
  }

  return { matches: true };
}

export function decidePriceAction(
  localPrice: LocalPriceData,
  inspection: PriceInspectionResult,
): PriceDecision {
  // Already SYNCED with a stored ID — verify it still matches, then skip re-creation.
  if (localPrice.stripeSyncStatus === StripeSyncStatus.SYNCED && localPrice.stripePriceId) {
    if (!inspection.found) {
      return {
        decision: "not-found-error",
        reason: `Price was SYNCED but Stripe ID ${localPrice.stripePriceId} no longer exists`,
      };
    }
    const match = verifyPriceMatch(localPrice, inspection.price);
    if (!match.matches) {
      return { decision: "mismatch-error", reason: match.mismatch! };
    }
    return { decision: "already-synced" };
  }

  // Has a stripePriceId (not yet SYNCED) — verify and mark.
  if (localPrice.stripePriceId) {
    if (!inspection.found) {
      return {
        decision: "not-found-error",
        reason: `Stripe price ID ${localPrice.stripePriceId} not found in Stripe`,
      };
    }
    const match = verifyPriceMatch(localPrice, inspection.price);
    if (!match.matches) {
      return { decision: "mismatch-error", reason: match.mismatch! };
    }
    return {
      decision: "reuse",
      stripePriceId: inspection.price.id,
      by: inspection.by as "price-id" | "lookup-key",
    };
  }

  // No stripePriceId — check if an existing Stripe price was found by lookup_key.
  if (inspection.found) {
    const match = verifyPriceMatch(localPrice, inspection.price);
    if (!match.matches) {
      return {
        decision: "mismatch-error",
        reason: `Lookup key found existing Stripe price but fields do not match: ${match.mismatch}`,
      };
    }
    return {
      decision: "reuse",
      stripePriceId: inspection.price.id,
      by: inspection.by as "price-id" | "lookup-key",
    };
  }

  // Nothing found anywhere — create.
  return { decision: "create" };
}

export function mapBillingIntervalToStripe(
  interval: BillingInterval,
): "day" | "week" | "month" | "year" {
  switch (interval) {
    case BillingInterval.DAY:
      return "day";
    case BillingInterval.WEEK:
      return "week";
    case BillingInterval.MONTH:
      return "month";
    case BillingInterval.YEAR:
      return "year";
  }
}

export function buildStripePriceCreateParams(
  price: LocalPriceData,
  stripeProductId: string,
): Stripe.PriceCreateParams {
  const params: Stripe.PriceCreateParams = {
    product: stripeProductId,
    currency: price.currencyCode.toLowerCase(),
    unit_amount: price.unitAmountMinor,
    lookup_key: price.lookupKey,
    transfer_lookup_key: false,
    metadata: {
      localPriceId: price.id,
      localProductId: price.product.id,
      localLookupKey: price.lookupKey,
    },
  };

  if (
    price.priceType === PriceType.RECURRING &&
    price.billingInterval !== null &&
    price.billingIntervalCount !== null
  ) {
    params.recurring = {
      interval: mapBillingIntervalToStripe(price.billingInterval),
      interval_count: price.billingIntervalCount,
    };
  }

  return params;
}

// ── Scope filter ───────────────────────────────────────────────────────────────

function isInScope(productType: ProductType, scope: SyncScope): boolean {
  if (scope === "all") return true;
  if (scope === "plans") return PLAN_PRODUCT_TYPES.has(productType);
  if (scope === "store") return STORE_PRODUCT_TYPES.has(productType);
  return false;
}

// ── Stripe helpers ─────────────────────────────────────────────────────────────

function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
}

async function findOrCreateStripeProduct(
  stripe: Stripe,
  product: LocalPriceData["product"],
  stripeMode: StripeMode,
  dryRun: boolean,
): Promise<{ stripeProductId: string; wasCreated: boolean }> {
  // Search by localProductId metadata first (most stable identifier).
  const byId = await stripe.products.search({
    query: `metadata['localProductId']:'${product.id}'`,
    limit: 1,
  });
  if (byId.data.length > 0) {
    return { stripeProductId: byId.data[0]!.id, wasCreated: false };
  }

  // Fallback: search by productSlug metadata (handles re-seed with new local IDs).
  const bySlug = await stripe.products.search({
    query: `metadata['productSlug']:'${product.slug}'`,
    limit: 1,
  });
  if (bySlug.data.length > 0) {
    return { stripeProductId: bySlug.data[0]!.id, wasCreated: false };
  }

  if (dryRun) {
    return { stripeProductId: "[dry-run-product-id]", wasCreated: true };
  }

  const created = await stripe.products.create({
    name: product.name,
    description: product.description ?? undefined,
    metadata: {
      app: "bookmyclass",
      environment: stripeMode,
      localProductId: product.id,
      productSlug: product.slug,
      productType: product.productType,
    },
  });
  return { stripeProductId: created.id, wasCreated: true };
}

async function inspectStripePrice(
  stripe: Stripe,
  localPrice: LocalPriceData,
): Promise<PriceInspectionResult> {
  // Existing stripePriceId: retrieve directly.
  if (localPrice.stripePriceId) {
    try {
      const sp = await stripe.prices.retrieve(localPrice.stripePriceId);
      const product =
        typeof sp.product === "string" ? sp.product : (sp.product as { id: string }).id;
      return {
        found: true,
        by: "price-id",
        price: {
          id: sp.id,
          currency: sp.currency,
          unit_amount: sp.unit_amount,
          type: sp.type,
          product,
          recurring: sp.recurring
            ? { interval: sp.recurring.interval, interval_count: sp.recurring.interval_count }
            : null,
          lookup_key: sp.lookup_key ?? null,
        },
      };
    } catch (err: unknown) {
      if (
        err instanceof Stripe.errors.StripeInvalidRequestError &&
        err.statusCode === 404
      ) {
        return { found: false, by: "price-id" };
      }
      throw err;
    }
  }

  // No stripePriceId: search by lookup_key.
  const listResult = await stripe.prices.list({
    lookup_keys: [localPrice.lookupKey],
    limit: 1,
  });
  if (listResult.data.length > 0) {
    const sp = listResult.data[0]!;
    const product =
      typeof sp.product === "string" ? sp.product : (sp.product as { id: string }).id;
    return {
      found: true,
      by: "lookup-key",
      price: {
        id: sp.id,
        currency: sp.currency,
        unit_amount: sp.unit_amount,
        type: sp.type,
        product,
        recurring: sp.recurring
          ? { interval: sp.recurring.interval, interval_count: sp.recurring.interval_count }
          : null,
        lookup_key: sp.lookup_key ?? null,
      },
    };
  }

  return { found: false, by: "none" };
}

// ── Core executor (exported for testing with mocked dependencies) ─────────────

export async function syncOnePrice(
  stripe: Stripe,
  localPrice: LocalPriceData,
  inspection: PriceInspectionResult,
  stripeMode: StripeMode,
  dryRun: boolean,
): Promise<PriceOutcome> {
  const base = {
    priceId: localPrice.id,
    lookupKey: localPrice.lookupKey,
    productSlug: localPrice.product.slug,
    productType: localPrice.product.productType,
  };

  // Store-specific validation before anything else.
  if (STORE_PRODUCT_TYPES.has(localPrice.product.productType)) {
    const validation = validateStorePrice({
      productType: localPrice.product.productType,
      currencyCode: localPrice.currencyCode,
      priceType: localPrice.priceType,
      unitAmountMinor: localPrice.unitAmountMinor,
      billingInterval: localPrice.billingInterval,
    });
    if (!validation.valid) {
      return {
        ...base,
        decision: { decision: "validation-error", reason: validation.error! },
        error: validation.error,
      };
    }
  }

  const decision = decidePriceAction(localPrice, inspection);

  switch (decision.decision) {
    case "already-synced":
      return { ...base, decision, finalStripePriceId: localPrice.stripePriceId! };

    case "mismatch-error":
    case "not-found-error":
    case "validation-error":
      return { ...base, decision, error: decision.reason };

    case "reuse": {
      if (!dryRun) {
        await prisma.price.update({
          where: { id: localPrice.id },
          data: {
            stripePriceId: decision.stripePriceId,
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeSyncLastAttempt: new Date(),
            stripeSyncLastSuccess: new Date(),
            stripeSyncErrorCode: null,
            stripeSyncError: null,
          },
        });
      }
      return {
        ...base,
        decision,
        finalStripePriceId: decision.stripePriceId,
        wasPriceCreated: false,
        dbUpdated: !dryRun,
      };
    }

    case "create": {
      const productResult = await findOrCreateStripeProduct(
        stripe,
        localPrice.product,
        stripeMode,
        dryRun,
      );

      // Dry-run: return what would happen, skip all mutations.
      if (dryRun) {
        return {
          ...base,
          decision,
          stripeProductId: productResult.stripeProductId,
          wasProductCreated: productResult.wasCreated,
          finalStripePriceId: "[dry-run-price-id]",
          wasPriceCreated: true,
          dbUpdated: false,
        };
      }

      const createParams = buildStripePriceCreateParams(localPrice, productResult.stripeProductId);
      const createdPrice = await stripe.prices.create(createParams);

      // Only mark SYNCED after Stripe confirms the price exists.
      await prisma.price.update({
        where: { id: localPrice.id },
        data: {
          stripePriceId: createdPrice.id,
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          stripeSyncLastAttempt: new Date(),
          stripeSyncLastSuccess: new Date(),
          stripeSyncErrorCode: null,
          stripeSyncError: null,
        },
      });

      return {
        ...base,
        decision,
        stripeProductId: productResult.stripeProductId,
        wasProductCreated: productResult.wasCreated,
        finalStripePriceId: createdPrice.id,
        wasPriceCreated: true,
        dbUpdated: true,
      };
    }
  }
}

// ── Summary builder ────────────────────────────────────────────────────────────

function buildSummary(
  outcomes: PriceOutcome[],
  scope: SyncScope,
  dryRun: boolean,
  stripeMode: StripeMode,
): SyncSummary {
  const uniqueProducts = new Set(outcomes.map((o) => o.productSlug));
  return {
    scope,
    dryRun,
    stripeMode,
    productsInspected: uniqueProducts.size,
    pricesInspected: outcomes.length,
    stripeProductsCreated: outcomes.filter((o) => o.wasProductCreated === true).length,
    stripeProductsReused: outcomes.filter(
      (o) => o.wasProductCreated === false && o.stripeProductId !== undefined,
    ).length,
    stripePricesCreated: outcomes.filter((o) => o.wasPriceCreated === true).length,
    stripePricesReused: outcomes.filter(
      (o) => o.wasPriceCreated === false && o.finalStripePriceId !== undefined,
    ).length,
    dbPricesUpdated: outcomes.filter((o) => o.dbUpdated === true).length,
    pricesAlreadySynced: outcomes.filter((o) => o.decision.decision === "already-synced").length,
    validationErrors: outcomes.filter((o) => o.decision.decision === "validation-error").length,
    mismatchErrors: outcomes.filter(
      (o) =>
        o.decision.decision === "mismatch-error" || o.decision.decision === "not-found-error",
    ).length,
    otherErrors: outcomes.filter(
      (o) =>
        o.error !== undefined &&
        o.decision.decision !== "validation-error" &&
        o.decision.decision !== "mismatch-error" &&
        o.decision.decision !== "not-found-error",
    ).length,
    outcomes,
  };
}

function printSummary(summary: SyncSummary): void {
  const dryRunLabel = summary.dryRun ? " [DRY RUN]" : "";
  const bar = "═".repeat(54);
  console.log(`\n${bar}`);
  console.log(`  Stripe Catalog Sync Summary${dryRunLabel}`);
  console.log(`  Mode: ${summary.stripeMode.toUpperCase()}  |  Scope: ${summary.scope}`);
  console.log(bar);
  console.log(`  Products inspected:      ${summary.productsInspected}`);
  console.log(`  Prices inspected:        ${summary.pricesInspected}`);
  console.log(`  Stripe products created: ${summary.stripeProductsCreated}`);
  console.log(`  Stripe products reused:  ${summary.stripeProductsReused}`);
  console.log(`  Stripe prices created:   ${summary.stripePricesCreated}`);
  console.log(`  Stripe prices reused:    ${summary.stripePricesReused}`);
  console.log(`  DB prices updated:       ${summary.dbPricesUpdated}`);
  console.log(`  Prices already synced:   ${summary.pricesAlreadySynced}`);
  console.log(`  Validation errors:       ${summary.validationErrors}`);
  console.log(`  Mismatch errors:         ${summary.mismatchErrors}`);
  console.log(`  Other errors:            ${summary.otherErrors}`);

  const errorOutcomes = summary.outcomes.filter((o) => o.error);
  if (errorOutcomes.length > 0) {
    console.log("\n  ── Errors ──────────────────────────────────────────");
    for (const o of errorOutcomes) {
      console.log(`  [ERROR] ${o.lookupKey}: ${o.error}`);
    }
  }

  const totalErrors = summary.validationErrors + summary.mismatchErrors + summary.otherErrors;
  if (totalErrors > 0) {
    console.log("\n  ── Next Steps ──────────────────────────────────────");
    console.log("  • Review the errors listed above.");
    console.log("  • Mismatch errors require admin review — Stripe prices are immutable.");
    console.log("  • For local amount changes, create a new Price record in the DB.");
    console.log("  • Validation errors must be fixed in the local catalog before re-running.");
  }

  if (summary.dryRun) {
    console.log("\n  ── Dry-Run Complete ────────────────────────────────");
    console.log("  No Stripe or DB mutations were performed.");
    console.log("  Remove --dry-run to apply changes.");
  }

  console.log(`${bar}\n`);
}

// ── CLI arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { scope: SyncScope; dryRun: boolean; confirmLive: boolean } {
  const args = argv.slice(2);
  const scopeArg = args.find((a) => a.startsWith("--scope="))?.split("=")[1];
  const scope: SyncScope =
    scopeArg === "plans" ? "plans" : scopeArg === "store" ? "store" : "all";
  const dryRun = args.includes("--dry-run");
  const confirmLive = args.includes("--confirm-live");
  return { scope, dryRun, confirmLive };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { scope, dryRun, confirmLive } = parseArgs(process.argv);

  if (!process.env.DATABASE_URL) {
    console.error("[sync-stripe-catalog] ERROR: DATABASE_URL is required.");
    process.exit(1);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error("[sync-stripe-catalog] ERROR: STRIPE_SECRET_KEY is required.");
    process.exit(1);
  }

  const stripeMode = resolveStripeMode(secretKey);
  if (!stripeMode) {
    console.error(
      "[sync-stripe-catalog] ERROR: STRIPE_SECRET_KEY must start with sk_test_ or sk_live_.",
    );
    process.exit(1);
  }

  if (requiresLiveConfirmation(stripeMode, confirmLive)) {
    console.error(
      "[sync-stripe-catalog] ERROR: Live Stripe key detected. Re-run with --confirm-live to proceed.",
    );
    console.error(
      "[sync-stripe-catalog]   npm run stripe:catalog:sync -- --scope=all --confirm-live",
    );
    process.exit(1);
  }

  const dryRunLabel = dryRun ? " [DRY RUN]" : "";
  console.log(
    `[sync-stripe-catalog] Starting${dryRunLabel} — mode=${stripeMode.toUpperCase()} scope=${scope}`,
  );

  const stripe = createStripeClient(secretKey);

  const allPrices = await prisma.price.findMany({
    where: {
      isArchived: false,
      product: { isArchived: false },
    },
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          productType: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  const prices = allPrices.filter((p) => isInScope(p.product.productType, scope));
  console.log(`[sync-stripe-catalog] Found ${prices.length} price(s) in scope (${scope}).`);

  const outcomes: PriceOutcome[] = [];

  for (const price of prices) {
    process.stdout.write(`  [${price.lookupKey}] `);
    try {
      const inspection = await inspectStripePrice(stripe, price);
      const outcome = await syncOnePrice(stripe, price, inspection, stripeMode, dryRun);
      outcomes.push(outcome);

      let statusLabel: string;
      switch (outcome.decision.decision) {
        case "already-synced":
          statusLabel = "✓ already synced";
          break;
        case "reuse":
          statusLabel = `✓ reused (${outcome.decision.by})`;
          break;
        case "create":
          statusLabel = dryRun ? "✓ would create" : "✓ created";
          break;
        default:
          statusLabel = `✗ ${outcome.error ?? outcome.decision.decision}`;
      }
      console.log(statusLabel);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      outcomes.push({
        priceId: price.id,
        lookupKey: price.lookupKey,
        productSlug: price.product.slug,
        productType: price.product.productType,
        decision: { decision: "validation-error", reason: errMsg },
        error: errMsg,
      });
      console.log(`✗ ERROR: ${errMsg}`);
    }
  }

  const summary = buildSummary(outcomes, scope, dryRun, stripeMode);
  printSummary(summary);

  await prisma.$disconnect();

  const totalErrors = summary.validationErrors + summary.mismatchErrors + summary.otherErrors;
  if (totalErrors > 0) {
    process.exit(1);
  }
}

// Run only when executed directly, not when imported in tests.
const isDirectExecution =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  main().catch((err: unknown) => {
    console.error(
      "[sync-stripe-catalog] Fatal error:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
