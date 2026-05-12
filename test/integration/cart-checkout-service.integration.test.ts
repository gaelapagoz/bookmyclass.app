import "./helpers/setup-env";

import {
  GiftCardCodeStatus,
  GiftCardLedgerEntryType,
  GiftCardWalletStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { startCartCheckout } from "../../src/lib/cart/cart-checkout-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

async function seedVerifiedClient() {
  return prisma.user.create({
    data: {
      name: "Test Client",
      email: `cart.svc.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });
}

async function seedGiftCardProduct(unitAmountMinor: number) {
  const ts = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const product = await prisma.product.create({
    data: {
      name: "Test Gift Card",
      slug: `test-gift-card-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `test-gc-price-${ts}`,
      stripePriceId: `price_test_gc_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "Gift Card Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor,
      isActive: true,
      isArchived: false,
    },
    select: { id: true },
  });
  return { product, price };
}

async function seedClientWallet(clientId: string, balanceMinor: number) {
  return prisma.giftCardWallet.create({
    data: {
      clientId,
      currencyCode: "EUR",
      balanceMinor,
      status: GiftCardWalletStatus.ACTIVE,
    },
    select: { id: true },
  });
}

describe("cart checkout service actor eligibility", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects non-client actors before cart resolution", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin",
        email: `cart.admin.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
      select: { id: true },
    });

    const response = await startCartCheckout({
      userId: admin.id,
      idempotencyKey: `cart_service_non_client_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  });

  it("rejects inactive clients before cart resolution", async () => {
    const client = await prisma.user.create({
      data: {
        name: "Inactive Client",
        email: `cart.inactive.${Date.now()}@example.test`,
        role: Role.CLIENT,
        activationStatus: UserActivationStatus.DISABLED,
      },
      select: { id: true },
    });

    const response = await startCartCheckout({
      userId: client.id,
      idempotencyKey: `cart_service_inactive_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [],
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("EMAIL_VERIFICATION_REQUIRED");
  });
});

describe("cart checkout service — full-wallet gift card purchase (code-issuance model)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("full-wallet gift card checkout issues a GiftCardCode (ISSUED) and marks order PAID", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedGiftCardProduct(2500);
    await seedClientWallet(client.id, 5000);

    const response = await startCartCheckout({
      userId: client.id,
      idempotencyKey: `cart_gc_full_wallet_code_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      walletAmountMinor: 2500,
    });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("completed");

    const issuedCode = await prisma.giftCardCode.findFirst({
      where: { purchasedById: client.id },
      select: { status: true, amountMinor: true },
    });
    expect(issuedCode).not.toBeNull();
    expect(issuedCode!.status).toBe(GiftCardCodeStatus.ISSUED);
    expect(issuedCode!.amountMinor).toBe(2500);

    const order = await prisma.order.findFirst({ where: { clientId: client.id }, select: { status: true } });
    expect(order?.status).toBe(OrderStatus.PAID);
  });

  it("replayed full-wallet gift card checkout does not issue duplicate GiftCardCodes", async () => {
    const client = await seedVerifiedClient();
    const { product, price } = await seedGiftCardProduct(2500);
    await seedClientWallet(client.id, 5000);

    const key = `cart_gc_replay_no_double_code_${Date.now()}`;
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];

    const first = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      clientCartVersion: "v1",
      lines,
      walletAmountMinor: 2500,
    });
    expect(first.status).toBe(200);
    expect(first.body.type).toBe("completed");

    const second = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      clientCartVersion: "v1",
      lines,
      walletAmountMinor: 2500,
    });
    expect(second.status).toBe(200);
    expect(second.body.idempotency?.replayed).toBe(true);

    const codeCount = await prisma.giftCardCode.count({ where: { purchasedById: client.id } });
    expect(codeCount).toBe(1);
  });

  it("full-wallet checkout of merchandise does not create gift card activation entry", async () => {
    const ts = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const product = await prisma.product.create({
      data: {
        name: "Test Merch",
        slug: `test-merch-${ts}`,
        productType: ProductType.MERCHANDISE,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `test-merch-price-${ts}`,
        stripePriceId: `price_test_merch_${ts}`,
        stripeSyncStatus: StripeSyncStatus.SYNCED,
        name: "Merch Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 1500,
        isActive: true,
        isArchived: false,
      },
      select: { id: true },
    });
    const client = await seedVerifiedClient();
    await seedClientWallet(client.id, 5000);

    const response = await startCartCheckout({
      userId: client.id,
      idempotencyKey: `cart_merch_full_wallet_${Date.now()}`,
      clientCartVersion: "v1",
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      walletAmountMinor: 1500,
    });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("completed");

    const activationCount = await prisma.giftCardLedgerEntry.count({
      where: {
        wallet: { clientId: client.id },
        entryType: GiftCardLedgerEntryType.ACTIVATION,
      },
    });
    expect(activationCount).toBe(0);
  });
});