import { PriceType, ProductType } from "@prisma/client";

export type StoreCatalogProduct = {
  slug: string;
  name: string;
  description: string;
  productType: ProductType;
  sortOrder: number;
  price: {
    lookupKey: string;
    stripePriceEnvVarName: string;
    name: string;
    priceType: PriceType;
    currencyCode: string;
    unitAmountMinor: number;
  };
};

export const STORE_GIFT_CARD_PRODUCTS: StoreCatalogProduct[] = [
  {
    slug: "store-gift-card-25-eur",
    name: "Gift Card €25",
    description: "A €25 gift card redeemable for any class, pack or merchandise at the studio.",
    productType: ProductType.GIFT_CARD,
    sortOrder: 70,
    price: {
      lookupKey: "store-gift-card-25-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR",
      name: "Gift Card €25 - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
    },
  },
  {
    slug: "store-gift-card-50-eur",
    name: "Gift Card €50",
    description: "A €50 gift card redeemable for any class, pack or merchandise at the studio.",
    productType: ProductType.GIFT_CARD,
    sortOrder: 80,
    price: {
      lookupKey: "store-gift-card-50-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR",
      name: "Gift Card €50 - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
    },
  },
  {
    slug: "store-gift-card-100-eur",
    name: "Gift Card €100",
    description: "A €100 gift card redeemable for any class, pack or merchandise at the studio.",
    productType: ProductType.GIFT_CARD,
    sortOrder: 90,
    price: {
      lookupKey: "store-gift-card-100-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR",
      name: "Gift Card €100 - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 10000,
    },
  },
];

export const STORE_MERCHANDISE_PRODUCTS: StoreCatalogProduct[] = [
  {
    slug: "store-merch-yoga-mat",
    name: "Studio Yoga Mat",
    description: "Premium non-slip yoga mat — in-store pickup only. No shipping or delivery available.",
    productType: ProductType.MERCHANDISE,
    sortOrder: 100,
    price: {
      lookupKey: "store-merch-yoga-mat-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT",
      name: "Studio Yoga Mat - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 4500,
    },
  },
  {
    slug: "store-merch-resistance-bands",
    name: "Resistance Band Set",
    description: "Set of 3 resistance bands for home practice — in-store pickup only. No shipping or delivery available.",
    productType: ProductType.MERCHANDISE,
    sortOrder: 110,
    price: {
      lookupKey: "store-merch-resistance-bands-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS",
      name: "Resistance Band Set - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
    },
  },
  {
    slug: "store-merch-studio-tote",
    name: "Studio Tote Bag",
    description: "Canvas tote bag with the studio logo — in-store pickup only. No shipping or delivery available.",
    productType: ProductType.MERCHANDISE,
    sortOrder: 120,
    price: {
      lookupKey: "store-merch-studio-tote-eur-once-v1",
      stripePriceEnvVarName: "STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE",
      name: "Studio Tote Bag - One Time",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3000,
    },
  },
];

export const STORE_CATALOG_PRODUCTS: StoreCatalogProduct[] = [
  ...STORE_GIFT_CARD_PRODUCTS,
  ...STORE_MERCHANDISE_PRODUCTS,
];

export const STORE_GIFT_CARD_DENOMINATIONS_MINOR = [2500, 5000, 10000] as const;

export const STORE_CATALOG_PRODUCT_COUNT = STORE_CATALOG_PRODUCTS.length;
