import { PriceType, ProductType, StripeSyncStatus } from "@prisma/client";
import type Stripe from "stripe";

import { prisma } from "@/lib/db";
import { getStripeClientForSecretKey } from "@/lib/payments/stripe";
const GIFT_CARD_MAX_AMOUNT_MINOR = 50_000;

function resolveStripeMode(secretKey: string): "test" | "live" | null {
  if (secretKey.startsWith("sk_live_")) return "live";
  if (secretKey.startsWith("sk_test_")) return "test";
  return null;
}

const STORE_PRODUCT_TYPES = new Set<ProductType>([
  ProductType.GIFT_CARD,
  ProductType.MERCHANDISE,
]);

export type StoreSyncResult =
  | { synced: true; stripePriceId: string; created: boolean }
  | { synced: false; reason: string };

type PriceForSync = {
  id: string;
  lookupKey: string;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  product: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    productType: ProductType;
  };
};

function validateForSync(price: PriceForSync): { valid: boolean; error?: string } {
  if (!STORE_PRODUCT_TYPES.has(price.product.productType)) {
    return { valid: false, error: "Not a store product type." };
  }
  if (price.priceType !== PriceType.ONE_TIME) {
    return { valid: false, error: "Store prices must be ONE_TIME." };
  }
  if (price.currencyCode !== "EUR") {
    return { valid: false, error: `Store prices must be EUR, got ${price.currencyCode}.` };
  }
  if (!Number.isInteger(price.unitAmountMinor) || price.unitAmountMinor <= 0) {
    return { valid: false, error: "Price amount must be a positive integer." };
  }
  if (
    price.product.productType === ProductType.GIFT_CARD &&
    price.unitAmountMinor > GIFT_CARD_MAX_AMOUNT_MINOR
  ) {
    return { valid: false, error: "Gift card amount exceeds EUR 500.00 maximum." };
  }
  return { valid: true };
}

async function findOrCreateStripeProduct(
  stripe: Stripe,
  product: PriceForSync["product"],
): Promise<string> {
  const byId = await stripe.products.search({
    query: `metadata['localProductId']:'${product.id}'`,
    limit: 1,
  });
  if (byId.data.length > 0) return byId.data[0]!.id;

  const bySlug = await stripe.products.search({
    query: `metadata['productSlug']:'${product.slug}'`,
    limit: 1,
  });
  if (bySlug.data.length > 0) return bySlug.data[0]!.id;

  const created = await stripe.products.create({
    name: product.name,
    description: product.description ?? undefined,
    metadata: {
      app: "bookmyclass",
      localProductId: product.id,
      productSlug: product.slug,
      productType: product.productType,
    },
  });
  return created.id;
}

async function findOrCreateStripePrice(
  stripe: Stripe,
  price: PriceForSync,
  stripeProductId: string,
): Promise<{ stripePriceId: string; created: boolean }> {
  if (price.stripePriceId) {
    try {
      const existing = await stripe.prices.retrieve(price.stripePriceId);
      return { stripePriceId: existing.id, created: false };
    } catch (err: unknown) {
      const statusCode = typeof err === "object" && err !== null && "statusCode" in err
        ? (err as { statusCode?: unknown }).statusCode
        : undefined;
      if (statusCode !== 404) {
        throw err;
      }
      // 404: stored price no longer exists in Stripe; fall through to lookup by key.
    }
  }

  const byKey = await stripe.prices.list({ lookup_keys: [price.lookupKey], limit: 1 });
  if (byKey.data.length > 0) {
    return { stripePriceId: byKey.data[0]!.id, created: false };
  }

  const created = await stripe.prices.create({
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
  });
  return { stripePriceId: created.id, created: true };
}

/**
 * Sync a single store Price record to Stripe.
 * Accepts an injectable Stripe client so callers can be tested without real API keys.
 * Never throws — all errors are recorded to the DB and returned as { synced: false }.
 */
export async function syncStorePriceToStripe(
  priceId: string,
  stripe: Stripe,
): Promise<StoreSyncResult> {
  const price = await prisma.price.findUnique({
    where: { id: priceId },
    select: {
      id: true,
      lookupKey: true,
      stripePriceId: true,
      stripeSyncStatus: true,
      priceType: true,
      currencyCode: true,
      unitAmountMinor: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          productType: true,
        },
      },
    },
  });

  if (!price) {
    return { synced: false, reason: "Price record not found." };
  }

  const priceForSync = price as PriceForSync;

  const validation = validateForSync(priceForSync);
  if (!validation.valid) {
    await prisma.price.update({
      where: { id: priceId },
      data: {
        stripeSyncStatus: StripeSyncStatus.FAILED,
        stripeSyncLastAttempt: new Date(),
        stripeSyncErrorCode: "VALIDATION_ERROR",
        stripeSyncError: validation.error ?? "Validation failed.",
      },
    });
    return { synced: false, reason: validation.error! };
  }

  // Already SYNCED: verify the Stripe price still exists.
  if (priceForSync.stripeSyncStatus === StripeSyncStatus.SYNCED && priceForSync.stripePriceId) {
    try {
      const existing = await stripe.prices.retrieve(priceForSync.stripePriceId);
      return { synced: true, stripePriceId: existing.id, created: false };
    } catch {
      // Price no longer exists in Stripe; fall through to re-sync.
    }
  }

  try {
    const stripeProductId = await findOrCreateStripeProduct(stripe, priceForSync.product);
    const { stripePriceId: finalPriceId, created } = await findOrCreateStripePrice(
      stripe,
      priceForSync,
      stripeProductId,
    );

    // Only write SYNCED after Stripe confirms the price exists.
    await prisma.price.update({
      where: { id: priceId },
      data: {
        stripePriceId: finalPriceId,
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        stripeSyncLastAttempt: new Date(),
        stripeSyncLastSuccess: new Date(),
        stripeSyncErrorCode: null,
        stripeSyncError: null,
      },
    });

    return { synced: true, stripePriceId: finalPriceId, created };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Stripe sync failed.";
    await prisma.price.update({
      where: { id: priceId },
      data: {
        stripeSyncStatus: StripeSyncStatus.FAILED,
        stripeSyncLastAttempt: new Date(),
        stripeSyncErrorCode: "STRIPE_ERROR",
        stripeSyncError: message,
      },
    });
    return { synced: false, reason: message };
  }
}

/**
 * Attempt Stripe sync using STRIPE_SECRET_KEY from the environment.
 * Returns null when STRIPE_SECRET_KEY is not configured (expected in dev without Stripe).
 * Live-mode keys require ALLOW_LIVE_STORE_SYNC=1 to proceed.
 * Never throws.
 */
export async function attemptStorePriceSyncFromEnv(
  priceId: string,
): Promise<StoreSyncResult | null> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  const mode = resolveStripeMode(secretKey);
  if (mode === null) {
    return { synced: false, reason: "Unrecognized Stripe key format." };
  }
  if (mode === "live" && process.env.ALLOW_LIVE_STORE_SYNC !== "1") {
    return {
      synced: false,
      reason: "Live Stripe key requires ALLOW_LIVE_STORE_SYNC=1 to proceed.",
    };
  }

  try {
    const stripe = getStripeClientForSecretKey(secretKey);
    return await syncStorePriceToStripe(priceId, stripe);
  } catch {
    return { synced: false, reason: "Unexpected sync initialization error." };
  }
}
