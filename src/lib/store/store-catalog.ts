import {
  OrderStatus,
  PaymentStatus,
  PriceType,
  ProductType,
  StripeSyncStatus,
  type BillingInterval,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { isStripePriceIdAllowedForRuntime } from "@/lib/catalog/checkout-readiness";
import { STORE_PRODUCT_TYPES, isStoreProductType } from "@/lib/catalog/product-scopes";
import {
  STORE_CURRENCY_CODE,
  STORE_MAX_GIFT_CARD_ORDER_TOTAL_MINOR,
  STORE_MAX_WALLET_BALANCE_MINOR,
  STORE_PICKUP_WORDING,
} from "@/lib/store/store-constants";
import type { MediaAssetReadModel } from "@/lib/media/product-media-service";
export {
  STORE_CURRENCY_CODE,
  STORE_MAX_GIFT_CARD_ORDER_TOTAL_MINOR,
  STORE_MAX_MERCHANDISE_QUANTITY_PER_PRODUCT,
  STORE_MAX_WALLET_BALANCE_MINOR,
  STORE_PICKUP_WORDING,
} from "@/lib/store/store-constants";

type StoreCatalogPrice = {
  id: string;
  name: string;
  lookupKey: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  isActive: boolean;
  isArchived: boolean;
};

type StoreCatalogProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productType: ProductType;
  imageAsset: Pick<MediaAssetReadModel, "id" | "path" | "mimeType" | "sizeBytes" | "originalFilename"> | null;
  prices: StoreCatalogPrice[];
};

export type StoreCatalogReadModel = StoreCatalogProduct & {
  fulfillmentLabel: typeof STORE_PICKUP_WORDING | null;
  checkoutPrices: StoreCatalogPrice[];
};

export type GiftCardPriceValidationResult =
  | { ok: true }
  | { ok: false; code: string; message: string };


export function validateGiftCardPriceForCheckoutExposure(input: {
  productType: ProductType;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval: BillingInterval | null;
  billingIntervalCount: number | null;
  isActive: boolean;
  isArchived: boolean;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
}): GiftCardPriceValidationResult {
  if (input.productType !== ProductType.GIFT_CARD) {
    return { ok: false, code: "NOT_GIFT_CARD", message: "Only gift-card prices use gift-card checkout exposure." };
  }

  if (input.currencyCode !== STORE_CURRENCY_CODE) {
    return { ok: false, code: "INVALID_CURRENCY", message: "Gift-card prices must be EUR." };
  }

  if (input.priceType !== PriceType.ONE_TIME || input.billingInterval || input.billingIntervalCount) {
    return { ok: false, code: "INVALID_PRICE_TYPE", message: "Gift-card prices must be one-time." };
  }

  if (!input.isActive || input.isArchived) {
    return { ok: false, code: "PRICE_NOT_ACTIVE", message: "Gift-card prices must be active and not archived." };
  }

  if (!Number.isInteger(input.unitAmountMinor) || input.unitAmountMinor <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Gift-card prices must be greater than zero." };
  }

  if (input.unitAmountMinor > STORE_MAX_GIFT_CARD_ORDER_TOTAL_MINOR) {
    return { ok: false, code: "AMOUNT_EXCEEDS_CAP", message: "Gift-card prices must not exceed 500 EUR." };
  }

  if (
    !input.stripePriceId ||
    input.stripeSyncStatus !== StripeSyncStatus.SYNCED ||
    !isStripePriceIdAllowedForRuntime(input.stripePriceId)
  ) {
    return { ok: false, code: "STRIPE_NOT_READY", message: "Gift-card prices require a synced Stripe price." };
  }

  return { ok: true };
}

export function isStorePriceCheckoutReady(input: {
  productType: ProductType;
  productIsActive: boolean;
  productIsArchived: boolean;
  price: StoreCatalogPrice;
}) {
  if (!isStoreProductType(input.productType) || !input.productIsActive || input.productIsArchived) {
    return false;
  }

  if (
    input.price.currencyCode !== STORE_CURRENCY_CODE ||
    input.price.priceType !== PriceType.ONE_TIME ||
    input.price.billingInterval ||
    input.price.billingIntervalCount ||
    !input.price.isActive ||
    input.price.isArchived ||
    !input.price.stripePriceId ||
    input.price.stripeSyncStatus !== StripeSyncStatus.SYNCED
  ) {
    return false;
  }

  if (input.productType === ProductType.GIFT_CARD) {
    return validateGiftCardPriceForCheckoutExposure({
      productType: input.productType,
      priceType: input.price.priceType,
      currencyCode: input.price.currencyCode,
      unitAmountMinor: input.price.unitAmountMinor,
      billingInterval: input.price.billingInterval,
      billingIntervalCount: input.price.billingIntervalCount,
      isActive: input.price.isActive,
      isArchived: input.price.isArchived,
      stripePriceId: input.price.stripePriceId,
      stripeSyncStatus: input.price.stripeSyncStatus,
    }).ok;
  }

  return (
    isStripePriceIdAllowedForRuntime(input.price.stripePriceId) &&
    Number.isInteger(input.price.unitAmountMinor) &&
    input.price.unitAmountMinor > 0
  );
}

export async function listStoreCatalogReadModels(): Promise<StoreCatalogReadModel[]> {
  const products = await prisma.product.findMany({
    where: {
      productType: { in: STORE_PRODUCT_TYPES as ProductType[] },
      isActive: true,
      isArchived: false,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      productType: true,
      isActive: true,
      isArchived: true,
      imageAsset: {
        select: {
          id: true,
          path: true,
          mimeType: true,
          sizeBytes: true,
          originalFilename: true,
        },
      },
      prices: {
        orderBy: [{ unitAmountMinor: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          lookupKey: true,
          priceType: true,
          currencyCode: true,
          unitAmountMinor: true,
          billingInterval: true,
          billingIntervalCount: true,
          stripePriceId: true,
          stripeSyncStatus: true,
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  const readModels = products.map((product) => {
    const checkoutPrices = product.prices.filter((price) =>
      isStorePriceCheckoutReady({
        productType: product.productType,
        productIsActive: product.isActive,
        productIsArchived: product.isArchived,
        price,
      }),
    );

    const fulfillmentLabel: typeof STORE_PICKUP_WORDING | null =
      product.productType === ProductType.MERCHANDISE ? STORE_PICKUP_WORDING : null;

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      productType: product.productType,
      imageAsset: product.imageAsset,
      prices: product.prices,
      checkoutPrices,
      fulfillmentLabel,
    };
  });

  const visible = readModels.filter((p) => p.checkoutPrices.length > 0);

  if (visible.length === 0) {
    const reasons: string[] = [];
    if (products.length === 0) {
      reasons.push("no active non-archived GIFT_CARD or MERCHANDISE products found in DB (run seed)");
    } else {
      for (const product of products) {
        for (const price of product.prices) {
          if (price.currencyCode !== STORE_CURRENCY_CODE) reasons.push(`${product.slug}: price ${price.lookupKey} has wrong currency ${price.currencyCode} (need ${STORE_CURRENCY_CODE})`);
          else if (price.priceType !== PriceType.ONE_TIME) reasons.push(`${product.slug}: price ${price.lookupKey} is not ONE_TIME`);
          else if (!price.isActive || price.isArchived) reasons.push(`${product.slug}: price ${price.lookupKey} is inactive or archived`);
          else if (!price.stripePriceId) reasons.push(`${product.slug}: price ${price.lookupKey} has no Stripe price ID (add ${product.productType === ProductType.GIFT_CARD ? "STRIPE_PRICE_ID_STORE_GIFT_CARD_*" : "STRIPE_PRICE_ID_STORE_MERCH_*"} env var and re-seed)`);
          else if (price.stripeSyncStatus !== StripeSyncStatus.SYNCED) reasons.push(`${product.slug}: price ${price.lookupKey} Stripe sync status is ${price.stripeSyncStatus} (not SYNCED)`);
          else if (!isStripePriceIdAllowedForRuntime(price.stripePriceId)) reasons.push(`${product.slug}: price ${price.lookupKey} Stripe price ID is for the wrong environment`);
        }
      }
    }
    console.info("[store-catalog] listStoreCatalogReadModels: 0 checkout-ready products.", reasons.length > 0 ? { reasons } : "");
  }

  return visible;
}

export async function assertGiftCardWalletCapPrecheck(input: {
  clientId: string;
  newGiftCardOrderTotalMinor: number;
}) {
  if (!Number.isInteger(input.newGiftCardOrderTotalMinor) || input.newGiftCardOrderTotalMinor < 0) {
    throw new Error("Gift-card order total must be a non-negative integer.");
  }

  const [wallet, pendingGiftCardOrders] = await Promise.all([
    prisma.giftCardWallet.findUnique({
      where: {
        clientId_currencyCode: {
          clientId: input.clientId,
          currencyCode: STORE_CURRENCY_CODE,
        },
      },
      select: { balanceMinor: true },
    }),
    prisma.order.findMany({
      where: {
        clientId: input.clientId,
        currencyCode: STORE_CURRENCY_CODE,
        status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] },
        OR: [
          {
            payments: {
              some: {
                status: PaymentStatus.PENDING,
              },
            },
          },
          {
            payments: {
              none: {},
            },
          },
        ],
        items: {
          some: {
            product: {
              productType: ProductType.GIFT_CARD,
            },
          },
        },
      },
      select: {
        items: {
          where: {
            product: {
              productType: ProductType.GIFT_CARD,
            },
          },
          select: {
            lineTotalAmountMinor: true,
          },
        },
      },
    }),
  ]);

  const balanceMinor = wallet?.balanceMinor ?? 0;
  const pendingGiftCardOrderValueMinor = pendingGiftCardOrders.reduce(
    (sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.lineTotalAmountMinor, 0),
    0,
  );
  const projectedBalanceMinor =
    balanceMinor + pendingGiftCardOrderValueMinor + input.newGiftCardOrderTotalMinor;

  return {
    ok: projectedBalanceMinor <= STORE_MAX_WALLET_BALANCE_MINOR,
    balanceMinor,
    pendingGiftCardOrderValueMinor,
    newGiftCardOrderTotalMinor: input.newGiftCardOrderTotalMinor,
    projectedBalanceMinor,
    maxWalletBalanceMinor: STORE_MAX_WALLET_BALANCE_MINOR,
  };
}

export const listStoreCatalog = listStoreCatalogReadModels;
