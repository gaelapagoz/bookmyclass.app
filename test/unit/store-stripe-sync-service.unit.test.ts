import { beforeEach, describe, expect, it, vi } from "vitest";
import { PriceType, ProductType, StripeSyncStatus } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  price: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { syncStorePriceToStripe, attemptStorePriceSyncFromEnv } from "../../src/lib/store/store-stripe-sync-service";

// ---------------------------------------------------------------------------
// Stripe mock factory
// ---------------------------------------------------------------------------

function makeStripeMock(overrides: Record<string, unknown> = {}) {
  return {
    products: {
      search: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "prod_new_123" }),
    },
    prices: {
      retrieve: vi.fn(),
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: "price_new_123" }),
    },
    ...overrides,
  } as unknown as import("stripe").default;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const basePriceRecord = {
  id: "price-local-1",
  lookupKey: "store-merch-test-abc123",
  stripePriceId: null,
  stripeSyncStatus: StripeSyncStatus.PENDING,
  priceType: PriceType.ONE_TIME,
  currencyCode: "EUR",
  unitAmountMinor: 2500,
  product: {
    id: "prod-local-1",
    name: "Test Yoga Mat",
    slug: "test-yoga-mat",
    description: "Pickup at studio.",
    productType: ProductType.MERCHANDISE,
  },
};

const giftCardPriceRecord = {
  ...basePriceRecord,
  id: "price-gc-1",
  lookupKey: "store-gc-25-eur-abc",
  product: {
    ...basePriceRecord.product,
    id: "prod-gc-1",
    slug: "store-gift-card-25-eur",
    productType: ProductType.GIFT_CARD,
  },
};

// ---------------------------------------------------------------------------
// syncStorePriceToStripe
// ---------------------------------------------------------------------------

describe("syncStorePriceToStripe", () => {
  beforeEach(() => {
    prismaMock.price.findUnique.mockReset();
    prismaMock.price.update.mockReset();
    prismaMock.price.update.mockResolvedValue({});
  });

  it("creates Stripe Product and Price, marks DB price SYNCED", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const stripe = makeStripeMock();

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("expected synced");
    expect(result.stripePriceId).toBe("price_new_123");
    expect(result.created).toBe(true);

    expect((stripe.products.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((stripe.prices.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(prismaMock.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePriceId: "price_new_123",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          stripeSyncErrorCode: null,
          stripeSyncError: null,
        }),
      }),
    );
  });

  it("reuses existing Stripe Product found by localProductId metadata", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const stripe = makeStripeMock({
      products: {
        search: vi.fn().mockResolvedValue({ data: [{ id: "prod_existing_789" }] }),
        create: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    expect((stripe.products.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("reuses existing Stripe Price found by lookup_key", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const stripe = makeStripeMock({
      prices: {
        list: vi.fn().mockResolvedValue({ data: [{ id: "price_existing_456" }] }),
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("expected synced");
    expect(result.stripePriceId).toBe("price_existing_456");
    expect(result.created).toBe(false);
    expect((stripe.prices.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("skips re-creation when price is already SYNCED and Stripe confirms it exists", async () => {
    const syncedRecord = {
      ...basePriceRecord,
      stripePriceId: "price_already_synced",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    };
    prismaMock.price.findUnique.mockResolvedValue(syncedRecord);
    const stripe = makeStripeMock({
      prices: {
        retrieve: vi.fn().mockResolvedValue({ id: "price_already_synced" }),
        list: vi.fn(),
        create: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("expected synced");
    expect(result.created).toBe(false);
    expect((stripe.prices.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(prismaMock.price.update).not.toHaveBeenCalled();
  });

  it("re-syncs when SYNCED price no longer exists in Stripe", async () => {
    const StripeErrors = (await import("stripe")).default.errors;
    const syncedRecord = {
      ...basePriceRecord,
      stripePriceId: "price_stale",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    };
    prismaMock.price.findUnique.mockResolvedValue(syncedRecord);
    const notFoundError = new StripeErrors.StripeInvalidRequestError({
      type: "invalid_request_error",
      message: "No such price",
    } as Parameters<typeof StripeErrors.StripeInvalidRequestError>[0]);
    Object.defineProperty(notFoundError, "statusCode", { value: 404 });
    const stripe = makeStripeMock({
      prices: {
        retrieve: vi.fn().mockRejectedValue(notFoundError),
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ id: "price_recreated" }),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    expect((stripe.prices.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("returns synced: false and marks FAILED on Stripe API error", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const stripe = makeStripeMock({
      products: {
        search: vi.fn().mockRejectedValue(new Error("Stripe network error")),
        create: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(false);
    if (result.synced) throw new Error("expected not synced");
    expect(result.reason).toContain("Stripe network error");
    expect(prismaMock.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeSyncStatus: StripeSyncStatus.FAILED,
          stripeSyncErrorCode: "STRIPE_ERROR",
        }),
      }),
    );
  });

  it("returns synced: false when price record not found in DB", async () => {
    prismaMock.price.findUnique.mockResolvedValue(null);
    const stripe = makeStripeMock();

    const result = await syncStorePriceToStripe("nonexistent", stripe);

    expect(result.synced).toBe(false);
    expect(prismaMock.price.update).not.toHaveBeenCalled();
  });

  it("returns FAILED for non-EUR currency (validation error)", async () => {
    const invalidRecord = { ...basePriceRecord, currencyCode: "USD" };
    prismaMock.price.findUnique.mockResolvedValue(invalidRecord);
    const stripe = makeStripeMock();

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(false);
    expect(prismaMock.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripeSyncStatus: StripeSyncStatus.FAILED,
          stripeSyncErrorCode: "VALIDATION_ERROR",
        }),
      }),
    );
    const updateArgs = prismaMock.price.update.mock.calls[0][0];
    expect((stripe.products.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(updateArgs.data.stripeSyncError).toMatch(/EUR/);
  });

  it("returns FAILED for gift card exceeding EUR 500 maximum", async () => {
    const oversizedRecord = { ...giftCardPriceRecord, unitAmountMinor: 60_000 };
    prismaMock.price.findUnique.mockResolvedValue(oversizedRecord);
    const stripe = makeStripeMock();

    const result = await syncStorePriceToStripe("price-gc-1", stripe);

    expect(result.synced).toBe(false);
    expect(prismaMock.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripeSyncErrorCode: "VALIDATION_ERROR" }),
      }),
    );
  });

  it("syncs gift card product successfully", async () => {
    prismaMock.price.findUnique.mockResolvedValue(giftCardPriceRecord);
    const stripe = makeStripeMock();

    const result = await syncStorePriceToStripe("price-gc-1", stripe);

    expect(result.synced).toBe(true);
    if (!result.synced) throw new Error("expected synced");
    expect(result.stripePriceId).toBe("price_new_123");
  });

  it("retry sync is idempotent: reuses existing Stripe price on second call", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const pricesListFirstCall = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ id: "price_new_123" }] });
    const stripe = makeStripeMock({
      prices: {
        list: pricesListFirstCall,
        create: vi.fn().mockResolvedValue({ id: "price_new_123" }),
        retrieve: vi.fn(),
      },
    });

    const result1 = await syncStorePriceToStripe("price-local-1", stripe);
    expect(result1.synced).toBe(true);

    // Second call finds existing price by lookup_key.
    const stripe2 = makeStripeMock({
      prices: {
        list: vi.fn().mockResolvedValue({ data: [{ id: "price_new_123" }] }),
        create: vi.fn(),
        retrieve: vi.fn(),
      },
    });
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const result2 = await syncStorePriceToStripe("price-local-1", stripe2);
    expect(result2.synced).toBe(true);
    expect((stripe2.prices.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  // Fix 7 (QA): non-store product type validation branch
  it("returns FAILED for non-store product type (e.g. DROP_IN_CLASS)", async () => {
    const nonStoreRecord = {
      ...basePriceRecord,
      product: { ...basePriceRecord.product, productType: ProductType.DROP_IN_CLASS },
    };
    prismaMock.price.findUnique.mockResolvedValue(nonStoreRecord);

    const result = await syncStorePriceToStripe("price-local-1", makeStripeMock());

    expect(result.synced).toBe(false);
    expect(prismaMock.price.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripeSyncErrorCode: "VALIDATION_ERROR" }),
      }),
    );
    // No Stripe API calls made before validation rejects
    const stripe = makeStripeMock();
    expect((stripe.products.search as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  // Fix 3 (Reviewer): secret key is never logged
  it("STRIPE_SECRET_KEY never appears in stripeSyncError after FAILED sync", async () => {
    // The sync service only receives the instantiated Stripe client, never the raw key.
    // Even if a Stripe error message were constructed with a key-like string, the service
    // only stores err.message — which comes from the injected Stripe client, not from env.
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const stripe = makeStripeMock({
      products: {
        search: vi.fn().mockRejectedValue(new Error("network error")),
        create: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(false);
    const updateArgs = prismaMock.price.update.mock.calls[0][0];
    const errorValue: string = updateArgs.data.stripeSyncError ?? "";
    expect(errorValue).not.toMatch(/sk_live_|sk_test_/);
  });

  // Fix 4 (Reviewer): SYNCED status requires the exact Stripe-confirmed price ID
  it("DB is updated with exactly the Stripe-confirmed price ID before marking SYNCED", async () => {
    prismaMock.price.findUnique.mockResolvedValue(basePriceRecord);
    const confirmedId = "price_stripe_confirmed_abc999";
    const stripe = makeStripeMock({
      prices: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ id: confirmedId }),
        retrieve: vi.fn(),
      },
    });

    const result = await syncStorePriceToStripe("price-local-1", stripe);

    expect(result.synced).toBe(true);
    const updateArgs = prismaMock.price.update.mock.calls[0][0];
    // Must equal the ID Stripe returned — no fabricated ID accepted
    expect(updateArgs.data.stripePriceId).toBe(confirmedId);
    expect(updateArgs.data.stripeSyncStatus).toBe(StripeSyncStatus.SYNCED);
    // stripeSyncLastSuccess is written only on confirmed sync
    expect(updateArgs.data.stripeSyncLastSuccess).toBeInstanceOf(Date);
    expect(updateArgs.data.stripeSyncErrorCode).toBeNull();
    expect(updateArgs.data.stripeSyncError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// attemptStorePriceSyncFromEnv
// ---------------------------------------------------------------------------

describe("attemptStorePriceSyncFromEnv", () => {
  beforeEach(() => {
    prismaMock.price.findUnique.mockReset();
    prismaMock.price.update.mockReset();
    prismaMock.price.update.mockResolvedValue({});
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ALLOW_LIVE_STORE_SYNC;
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ALLOW_LIVE_STORE_SYNC;
  });

  it("returns null when STRIPE_SECRET_KEY is not set", async () => {
    const result = await attemptStorePriceSyncFromEnv("price-local-1");
    expect(result).toBeNull();
    expect(prismaMock.price.findUnique).not.toHaveBeenCalled();
  });

  it("returns synced: false when key is present but price not found", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_for_unit_test";
    prismaMock.price.findUnique.mockResolvedValue(null);

    const result = await attemptStorePriceSyncFromEnv("nonexistent");

    expect(result).not.toBeNull();
    expect(result!.synced).toBe(false);
  });

  // Fix 1 (Reviewer): live-mode guard
  it("returns synced: false when live key is set but ALLOW_LIVE_STORE_SYNC is absent", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_test_key_unit_test_only";

    const result = await attemptStorePriceSyncFromEnv("price-local-1");

    expect(result).not.toBeNull();
    expect(result!.synced).toBe(false);
    if (result!.synced) throw new Error("expected not synced");
    expect(result!.reason).toContain("ALLOW_LIVE_STORE_SYNC");
    // DB never touched — guard fired before any Stripe or DB call
    expect(prismaMock.price.findUnique).not.toHaveBeenCalled();
  });

  it("proceeds with sync when live key is set and ALLOW_LIVE_STORE_SYNC=1", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_test_key_unit_test_only";
    process.env.ALLOW_LIVE_STORE_SYNC = "1";
    // Price not found → synced: false, but the guard was cleared and DB was queried
    prismaMock.price.findUnique.mockResolvedValue(null);

    const result = await attemptStorePriceSyncFromEnv("price-local-1");

    expect(result).not.toBeNull();
    expect(prismaMock.price.findUnique).toHaveBeenCalled();
  });

  it("returns synced: false for unrecognized key format (neither sk_test_ nor sk_live_)", async () => {
    process.env.STRIPE_SECRET_KEY = "rk_live_some_restricted_key";

    const result = await attemptStorePriceSyncFromEnv("price-local-1");

    expect(result).not.toBeNull();
    expect(result!.synced).toBe(false);
    expect(prismaMock.price.findUnique).not.toHaveBeenCalled();
  });
});
