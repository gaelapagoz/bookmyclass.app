import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the db module before importing the script so no real DB connection is made.
vi.mock("../../src/lib/db", () => ({
  default: {
    price: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  type LocalPriceData,
  type PriceInspectionResult,
  type StripePriceSnapshot,
  buildStripePriceCreateParams,
  decidePriceAction,
  mapBillingIntervalToStripe,
  requiresLiveConfirmation,
  resolveStripeMode,
  syncOnePrice,
  validateStorePrice,
  verifyPriceMatch,
} from "../../scripts/sync-stripe-catalog";
import { BillingInterval, PriceType, ProductType, StripeSyncStatus } from "@prisma/client";

// ── Test fixtures ──────────────────────────────────────────────────────────────

function makeLocalPrice(overrides: Partial<LocalPriceData> = {}): LocalPriceData {
  return {
    id: "price_local_001",
    lookupKey: "collective-drop-in-eur-once-v1",
    stripePriceId: null,
    stripeSyncStatus: StripeSyncStatus.PENDING,
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 2200,
    billingInterval: null,
    billingIntervalCount: null,
    isActive: true,
    isArchived: false,
    product: {
      id: "prod_local_001",
      slug: "collective-drop-in",
      name: "Collective Class Drop-In",
      description: "Single booking access.",
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
    },
    ...overrides,
  };
}

function makeStripePrice(overrides: Partial<StripePriceSnapshot> = {}): StripePriceSnapshot {
  return {
    id: "price_stripe_test_abc123",
    currency: "eur",
    unit_amount: 2200,
    type: "one_time",
    product: "prod_stripe_test_xyz",
    recurring: null,
    lookup_key: "collective-drop-in-eur-once-v1",
    ...overrides,
  };
}

// Minimal mock Stripe client for executor tests
function makeMockStripe(overrides: Record<string, unknown> = {}) {
  return {
    products: {
      search: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "prod_stripe_created_001" }),
    },
    prices: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      retrieve: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: "price_stripe_created_001" }),
    },
    ...overrides,
  };
}

// ── resolveStripeMode ──────────────────────────────────────────────────────────

describe("resolveStripeMode", () => {
  it("returns test for sk_test_ key", () => {
    expect(resolveStripeMode("sk_test_abc123")).toBe("test");
  });

  it("returns live for sk_live_ key", () => {
    expect(resolveStripeMode("sk_live_abc123")).toBe("live");
  });

  it("returns null for empty string — missing STRIPE_SECRET_KEY fails safely", () => {
    expect(resolveStripeMode("")).toBeNull();
  });

  it("returns null for unrecognized key format", () => {
    expect(resolveStripeMode("sk_unknown_abc")).toBeNull();
  });

  it("returns null for arbitrary string", () => {
    expect(resolveStripeMode("not-a-stripe-key")).toBeNull();
  });
});

// ── requiresLiveConfirmation ───────────────────────────────────────────────────

describe("requiresLiveConfirmation", () => {
  it("returns true for live mode without --confirm-live — script must abort", () => {
    expect(requiresLiveConfirmation("live", false)).toBe(true);
  });

  it("returns false for live mode with --confirm-live — allowed to proceed", () => {
    expect(requiresLiveConfirmation("live", true)).toBe(false);
  });

  it("returns false for test mode without --confirm-live — no guard needed", () => {
    expect(requiresLiveConfirmation("test", false)).toBe(false);
  });

  it("returns false for test mode with --confirm-live — flag is ignored for test", () => {
    expect(requiresLiveConfirmation("test", true)).toBe(false);
  });
});

// ── validateStorePrice ─────────────────────────────────────────────────────────

describe("validateStorePrice — gift card", () => {
  it("accepts valid EUR one-time gift card within the limit", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "EUR",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 2500,
      billingInterval: null,
    });
    expect(result.valid).toBe(true);
  });

  it("accepts gift card exactly at EUR 500 limit (50000 cents)", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "EUR",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 50_000,
      billingInterval: null,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects gift card exceeding EUR 500 (50001 cents)", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "EUR",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 50_001,
      billingInterval: null,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("50001");
    expect(result.error).toContain("50000");
  });

  it("rejects gift card with non-EUR currency", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "USD",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 2500,
      billingInterval: null,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("EUR");
  });

  it("rejects gift card with RECURRING price type", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "EUR",
      priceType: PriceType.RECURRING,
      unitAmountMinor: 2500,
      billingInterval: BillingInterval.MONTH,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ONE_TIME");
  });

  it("rejects gift card with zero amount", () => {
    const result = validateStorePrice({
      productType: ProductType.GIFT_CARD,
      currencyCode: "EUR",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 0,
      billingInterval: null,
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateStorePrice — merchandise", () => {
  it("accepts valid EUR one-time merchandise price", () => {
    const result = validateStorePrice({
      productType: ProductType.MERCHANDISE,
      currencyCode: "EUR",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 4500,
      billingInterval: null,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects merchandise with non-EUR currency", () => {
    const result = validateStorePrice({
      productType: ProductType.MERCHANDISE,
      currencyCode: "GBP",
      priceType: PriceType.ONE_TIME,
      unitAmountMinor: 4500,
      billingInterval: null,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects merchandise with RECURRING price type", () => {
    const result = validateStorePrice({
      productType: ProductType.MERCHANDISE,
      currencyCode: "EUR",
      priceType: PriceType.RECURRING,
      unitAmountMinor: 4500,
      billingInterval: BillingInterval.MONTH,
    });
    expect(result.valid).toBe(false);
  });
});

// ── verifyPriceMatch ───────────────────────────────────────────────────────────

describe("verifyPriceMatch", () => {
  it("returns matches=true when all fields agree", () => {
    const local = makeLocalPrice();
    const stripe = makeStripePrice();
    expect(verifyPriceMatch(local, stripe)).toEqual({ matches: true });
  });

  it("detects currency mismatch and does not silently accept", () => {
    const local = makeLocalPrice({ currencyCode: "EUR" });
    const stripe = makeStripePrice({ currency: "usd" });
    const result = verifyPriceMatch(local, stripe);
    expect(result.matches).toBe(false);
    expect(result.mismatch).toMatch(/currency/i);
  });

  it("detects amount mismatch — must be reported, not silently overwritten", () => {
    const local = makeLocalPrice({ unitAmountMinor: 2200 });
    const stripe = makeStripePrice({ unit_amount: 1900 });
    const result = verifyPriceMatch(local, stripe);
    expect(result.matches).toBe(false);
    expect(result.mismatch).toMatch(/amount/i);
    expect(result.mismatch).toContain("2200");
    expect(result.mismatch).toContain("1900");
  });

  it("detects type mismatch (one_time vs recurring)", () => {
    const local = makeLocalPrice({ priceType: PriceType.ONE_TIME });
    const stripe = makeStripePrice({ type: "recurring" });
    const result = verifyPriceMatch(local, stripe);
    expect(result.matches).toBe(false);
    expect(result.mismatch).toMatch(/type/i);
  });

  it("matches a valid recurring price with correct interval and count", () => {
    const local = makeLocalPrice({
      priceType: PriceType.RECURRING,
      unitAmountMinor: 12900,
      currencyCode: "EUR",
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    });
    const stripe = makeStripePrice({
      type: "recurring",
      unit_amount: 12900,
      recurring: { interval: "month", interval_count: 1 },
    });
    expect(verifyPriceMatch(local, stripe)).toEqual({ matches: true });
  });

  it("detects interval mismatch for recurring price", () => {
    const local = makeLocalPrice({
      priceType: PriceType.RECURRING,
      unitAmountMinor: 12900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    });
    const stripe = makeStripePrice({
      type: "recurring",
      unit_amount: 12900,
      recurring: { interval: "year", interval_count: 1 },
    });
    const result = verifyPriceMatch(local, stripe);
    expect(result.matches).toBe(false);
    expect(result.mismatch).toMatch(/interval/i);
  });

  it("detects interval_count mismatch for recurring price", () => {
    const local = makeLocalPrice({
      priceType: PriceType.RECURRING,
      unitAmountMinor: 12900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
    });
    const stripe = makeStripePrice({
      type: "recurring",
      unit_amount: 12900,
      recurring: { interval: "month", interval_count: 3 },
    });
    const result = verifyPriceMatch(local, stripe);
    expect(result.matches).toBe(false);
    expect(result.mismatch).toMatch(/interval_count/i);
  });
});

// ── decidePriceAction ──────────────────────────────────────────────────────────

describe("decidePriceAction", () => {
  it("returns already-synced when price is SYNCED and Stripe price matches", () => {
    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "price-id",
      price: makeStripePrice({ id: "price_stripe_test_abc123" }),
    };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("already-synced");
  });

  it("returns create when stripePriceId is missing and not found in Stripe", () => {
    const local = makeLocalPrice({
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });
    const inspection: PriceInspectionResult = { found: false, by: "none" };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("create");
  });

  it("returns reuse when lookup_key matches existing Stripe price", () => {
    const local = makeLocalPrice({
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "lookup-key",
      price: makeStripePrice({ id: "price_existing_lookup_789" }),
    };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("reuse");
    if (result.decision === "reuse") {
      expect(result.stripePriceId).toBe("price_existing_lookup_789");
      expect(result.by).toBe("lookup-key");
    }
  });

  it("returns reuse when existing stripePriceId is found and fields match", () => {
    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "price-id",
      price: makeStripePrice({ id: "price_stripe_test_abc123" }),
    };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("reuse");
    if (result.decision === "reuse") {
      expect(result.by).toBe("price-id");
    }
  });

  it("returns mismatch-error when amount differs — not silently overwritten", () => {
    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      unitAmountMinor: 2200,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "price-id",
      price: makeStripePrice({ id: "price_stripe_test_abc123", unit_amount: 1900 }),
    };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("mismatch-error");
    if (result.decision === "mismatch-error") {
      expect(result.reason).toMatch(/amount/i);
    }
  });

  it("returns not-found-error when SYNCED price no longer exists in Stripe", () => {
    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const inspection: PriceInspectionResult = { found: false, by: "price-id" };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("not-found-error");
  });

  it("is idempotent: same SYNCED+matching inputs always return already-synced", () => {
    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "price-id",
      price: makeStripePrice({ id: "price_stripe_test_abc123" }),
    };
    const result1 = decidePriceAction(local, inspection);
    const result2 = decidePriceAction(local, inspection);
    expect(result1.decision).toBe("already-synced");
    expect(result2.decision).toBe("already-synced");
  });

  it("returns mismatch-error when lookup_key finds existing price with different amount", () => {
    const local = makeLocalPrice({
      stripePriceId: null,
      unitAmountMinor: 2200,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "lookup-key",
      price: makeStripePrice({ unit_amount: 3000 }),
    };
    const result = decidePriceAction(local, inspection);
    expect(result.decision).toBe("mismatch-error");
  });
});

// ── mapBillingIntervalToStripe ─────────────────────────────────────────────────

describe("mapBillingIntervalToStripe", () => {
  it("maps MONTH to month", () => expect(mapBillingIntervalToStripe(BillingInterval.MONTH)).toBe("month"));
  it("maps YEAR to year", () => expect(mapBillingIntervalToStripe(BillingInterval.YEAR)).toBe("year"));
  it("maps DAY to day", () => expect(mapBillingIntervalToStripe(BillingInterval.DAY)).toBe("day"));
  it("maps WEEK to week", () => expect(mapBillingIntervalToStripe(BillingInterval.WEEK)).toBe("week"));
});

// ── buildStripePriceCreateParams ───────────────────────────────────────────────

describe("buildStripePriceCreateParams", () => {
  it("maps recurring membership price to Stripe recurring params", () => {
    const local = makeLocalPrice({
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 12900,
      billingInterval: BillingInterval.MONTH,
      billingIntervalCount: 1,
      product: {
        id: "prod_local_002",
        slug: "monthly-unlimited-collective",
        name: "Monthly Unlimited Collective",
        description: null,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
      },
    });
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_abc");
    expect(params.currency).toBe("eur");
    expect(params.unit_amount).toBe(12900);
    expect(params.recurring).toMatchObject({ interval: "month", interval_count: 1 });
  });

  it("maps store gift card to one-time Stripe params — no recurring field", () => {
    const local = makeLocalPrice({
      lookupKey: "store-gift-card-25-eur-once-v1",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
      billingInterval: null,
      billingIntervalCount: null,
      product: {
        id: "prod_local_gc_001",
        slug: "store-gift-card-25-eur",
        name: "Gift Card €25",
        description: null,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
      },
    });
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_gc");
    expect(params.currency).toBe("eur");
    expect(params.unit_amount).toBe(2500);
    expect(params.recurring).toBeUndefined();
    expect(params.lookup_key).toBe("store-gift-card-25-eur-once-v1");
  });

  it("maps merchandise to one-time Stripe params — no recurring field", () => {
    const local = makeLocalPrice({
      lookupKey: "store-merch-yoga-mat-eur-once-v1",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 4500,
      billingInterval: null,
      billingIntervalCount: null,
      product: {
        id: "prod_local_merch_001",
        slug: "store-merch-yoga-mat",
        name: "Studio Yoga Mat",
        description: null,
        productType: ProductType.MERCHANDISE,
        isActive: true,
        isArchived: false,
      },
    });
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_merch");
    expect(params.recurring).toBeUndefined();
    expect(params.unit_amount).toBe(4500);
  });

  it("sets lookup_key from local price lookupKey", () => {
    const local = makeLocalPrice({ lookupKey: "collective-drop-in-eur-once-v1" });
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_x");
    expect(params.lookup_key).toBe("collective-drop-in-eur-once-v1");
  });

  it("sets transfer_lookup_key=false to prevent overwriting live lookup keys", () => {
    const local = makeLocalPrice();
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_x");
    expect(params.transfer_lookup_key).toBe(false);
  });

  it("includes localPriceId and localProductId in metadata", () => {
    const local = makeLocalPrice({ id: "price_local_custom_001" });
    const params = buildStripePriceCreateParams(local, "prod_stripe_test_x");
    expect(params.metadata?.localPriceId).toBe("price_local_custom_001");
    expect(params.metadata?.localProductId).toBe("prod_local_001");
  });
});

// ── syncOnePrice — dry-run behavior ───────────────────────────────────────────

describe("syncOnePrice — dry-run does not mutate DB or Stripe", () => {
  let mockStripe: ReturnType<typeof makeMockStripe>;

  beforeEach(() => {
    mockStripe = makeMockStripe();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not call stripe.products.create or stripe.prices.create in dry-run", async () => {
    const local = makeLocalPrice({
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });
    const inspection: PriceInspectionResult = { found: false, by: "none" };

    const outcome = await syncOnePrice(
      mockStripe as unknown as import("stripe").default,
      local,
      inspection,
      "test",
      true, // dryRun
    );

    expect(mockStripe.products.create).not.toHaveBeenCalled();
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(outcome.dbUpdated).toBe(false);
    expect(outcome.finalStripePriceId).toBe("[dry-run-price-id]");
  });

  it("does not write to DB when decision is reuse and dryRun=true", async () => {
    const { default: mockPrisma } = await import("../../src/lib/db");

    const local = makeLocalPrice({
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "lookup-key",
      price: makeStripePrice({ id: "price_existing_test_001" }),
    };

    const outcome = await syncOnePrice(
      mockStripe as unknown as import("stripe").default,
      local,
      inspection,
      "test",
      true, // dryRun
    );

    expect(mockPrisma.price.update).not.toHaveBeenCalled();
    expect(outcome.dbUpdated).toBe(false);
    expect(outcome.decision.decision).toBe("reuse");
  });

  it("returns already-synced immediately without any Stripe or DB calls", async () => {
    const { default: mockPrisma } = await import("../../src/lib/db");

    const local = makeLocalPrice({
      stripePriceId: "price_stripe_test_abc123",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const inspection: PriceInspectionResult = {
      found: true,
      by: "price-id",
      price: makeStripePrice({ id: "price_stripe_test_abc123" }),
    };

    const outcome = await syncOnePrice(
      mockStripe as unknown as import("stripe").default,
      local,
      inspection,
      "test",
      false, // not dryRun — still no DB write for already-synced
    );

    expect(mockPrisma.price.update).not.toHaveBeenCalled();
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
    expect(outcome.decision.decision).toBe("already-synced");
  });
});

// ── syncOnePrice — store validation integration ────────────────────────────────

describe("syncOnePrice — store product validation", () => {
  it("rejects gift card with amount > EUR 500 before any Stripe call", async () => {
    const mockStripe = makeMockStripe();
    const local = makeLocalPrice({
      stripePriceId: null,
      unitAmountMinor: 60_000, // EUR 600 — over the limit
      product: {
        id: "prod_local_gc_big",
        slug: "store-gift-card-600-eur",
        name: "Gift Card €600",
        description: null,
        productType: ProductType.GIFT_CARD,
        isActive: true,
        isArchived: false,
      },
    });
    const inspection: PriceInspectionResult = { found: false, by: "none" };

    const outcome = await syncOnePrice(
      mockStripe as unknown as import("stripe").default,
      local,
      inspection,
      "test",
      false,
    );

    expect(outcome.decision.decision).toBe("validation-error");
    expect(outcome.error).toContain("60000");
    expect(mockStripe.products.search).not.toHaveBeenCalled();
    expect(mockStripe.prices.create).not.toHaveBeenCalled();
  });
});
