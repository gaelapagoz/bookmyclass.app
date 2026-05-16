import { expect, test } from "@playwright/test";
import {
  GiftCardLedgerEntryType,
  GiftCardReconciliationStatus,
  GiftCardRedemptionStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  UserActivationStatus,
  UserCreatedVia,
} from "@prisma/client";
import { hash } from "bcryptjs";

import prisma from "../../src/lib/db";
import { signInAdmin } from "./support/auth";
import { E2E_PASSWORD } from "./support/constants";

const password = E2E_PASSWORD;

function unique(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

async function createStaff(role: Role.ADMIN | Role.MASTER_ADMIN) {
  const email = `${unique(role.toLowerCase())}@bookmyclass.app`;
  const passwordHash = await hash(password, 12);
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: `${role} Gift Card E2E`,
      email,
      passwordHash,
      role,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });

  return { user, credentials: { email, password } };
}

async function createClient() {
  const email = `${unique("gift.client")}@bookmyclass.app`;
  const now = new Date();
  return prisma.user.create({
    data: {
      name: "Gift Card E2E Client",
      email,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });
}

async function createProduct(productType: ProductType, amountMinor: number) {
  const id = unique("gift-card-admin-product");
  const product = await prisma.product.create({
    data: {
      name: `${productType} E2E`,
      slug: id,
      productType,
      isActive: true,
      isArchived: false,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${id}-price`,
      name: `${productType} E2E Price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      isActive: true,
      isArchived: false,
    },
  });

  return { product, price };
}

async function createManualReviewCase(clientId: string) {
  const giftCardProduct = await createProduct(ProductType.GIFT_CARD, 10_000);
  const giftCardOrder = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: 10_000,
      totalAmountMinor: 10_000,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
    },
  });
  const giftCardOrderItem = await prisma.orderItem.create({
    data: {
      orderId: giftCardOrder.id,
      productId: giftCardProduct.product.id,
      priceId: giftCardProduct.price.id,
      productNameSnapshot: giftCardProduct.product.name,
      priceNameSnapshot: giftCardProduct.price.name,
      unitAmountMinor: 10_000,
      lineSubtotalAmountMinor: 10_000,
      lineTotalAmountMinor: 10_000,
      currencyCode: "EUR",
    },
  });
  const wallet = await prisma.giftCardWallet.create({
    data: {
      clientId,
      currencyCode: "EUR",
      balanceMinor: 7_500,
      status: GiftCardWalletStatus.ACTIVE,
    },
  });
  await prisma.giftCardLedgerEntry.create({
    data: {
      walletId: wallet.id,
      clientId,
      entryType: GiftCardLedgerEntryType.ACTIVATION,
      amountMinor: 10_000,
      currencyCode: "EUR",
      orderId: giftCardOrder.id,
      orderItemId: giftCardOrderItem.id,
      idempotencyKey: `e2e:activation:${giftCardOrderItem.id}`,
      payloadHash: "e2e-activation",
      happenedAt: new Date("2026-01-01T10:00:00.000Z"),
    },
  });

  const merch = await createProduct(ProductType.MERCHANDISE, 2_500);
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: 2_500,
      totalAmountMinor: 2_500,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
      items: {
        create: {
          productId: merch.product.id,
          priceId: merch.price.id,
          productNameSnapshot: merch.product.name,
          priceNameSnapshot: merch.price.name,
          unitAmountMinor: 2_500,
          lineSubtotalAmountMinor: 2_500,
          lineTotalAmountMinor: 2_500,
          currencyCode: "EUR",
        },
      },
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.SUCCEEDED,
      method: PaymentMethod.GIFT_CARD,
      provider: PaymentProvider.INTERNAL,
      amountMinor: 2_500,
      currencyCode: "EUR",
    },
  });
  const redemption = await prisma.giftCardRedemption.create({
    data: {
      walletId: wallet.id,
      clientId,
      orderId: order.id,
      status: GiftCardRedemptionStatus.CAPTURED,
      reservedAmountMinor: 2_500,
      capturedAmountMinor: 2_500,
      currencyCode: "EUR",
      idempotencyKey: `e2e:redemption:${order.id}`,
      payloadHash: "e2e-redemption",
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  await prisma.giftCardLedgerEntry.createMany({
    data: [
      {
        walletId: wallet.id,
        clientId,
        entryType: GiftCardLedgerEntryType.RESERVE,
        amountMinor: 2_500,
        currencyCode: "EUR",
        orderId: order.id,
        redemptionId: redemption.id,
        idempotencyKey: `e2e:reserve:${order.id}`,
        payloadHash: "e2e-reserve",
        happenedAt: new Date("2026-01-01T10:01:00.000Z"),
      },
      {
        walletId: wallet.id,
        clientId,
        entryType: GiftCardLedgerEntryType.CAPTURE,
        amountMinor: 2_500,
        currencyCode: "EUR",
        orderId: order.id,
        paymentId: payment.id,
        redemptionId: redemption.id,
        idempotencyKey: `e2e:capture:${redemption.id}`,
        payloadHash: "e2e-capture",
        happenedAt: new Date("2026-01-01T10:02:00.000Z"),
      },
    ],
  });

  const reconciliationCase = await prisma.giftCardReconciliationCase.create({
    data: {
      orderId: order.id,
      clientId,
      walletId: wallet.id,
      redemptionId: redemption.id,
      paymentId: payment.id,
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      reason: "e2e_manual_review",
      idempotencyKey: `e2e:manual-review:${order.id}`,
      metadata: {},
    },
  });

  return { wallet, reconciliationCase };
}

test.describe("gift-card admin visibility and permissions", () => {
  // @covers admin-gift-card-wallet-readonly
  // @covers admin-gift-card-resolve-admin-denied
  test("ADMIN sees read-only wallet lookup and resolve API remains forbidden", async ({ page }) => {
    const admin = await createStaff(Role.ADMIN);
    const client = await createClient();
    const { reconciliationCase } = await createManualReviewCase(client.id);

    await signInAdmin(page, admin.credentials);
    await page.goto(`/admin/gift-cards?clientId=${encodeURIComponent(client.id)}`);

    await expect(page.getByRole("heading", { name: "Gift Cards", exact: true })).toBeVisible();
    await expect(page.getByText("€75.00").first()).toBeVisible();
    await expect(page.getByText("Resolve via API after verification")).toHaveCount(0);
    const walletLookupResponse = await page.request.get(
      `/api/admin/gift-cards/wallets?clientId=${encodeURIComponent(client.id)}`,
    );
    expect(walletLookupResponse.status()).toBe(200);
    const walletLookupJson = await walletLookupResponse.json();
    expect(walletLookupJson.ledgerEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ entryType: "CAPTURE" })]),
    );
    expect(walletLookupJson.reconciliationCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reconciliationCase.id,
          status: "MANUAL_REVIEW",
        }),
      ]),
    );

    const response = await page.request.post(
      `/api/admin/gift-cards/reconciliation/${encodeURIComponent(reconciliationCase.id)}/resolve`,
      {
        headers: {
          origin: "http://127.0.0.1:3100",
          referer: "http://127.0.0.1:3100/admin/gift-cards",
        },
        data: { note: "ADMIN should not resolve this case." },
      },
    );

    expect(response.status()).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "GIFT_CARD_MASTER_ADMIN_REQUIRED" });
  });

  // @covers admin-gift-card-master-resolve
  // @covers admin-gift-card-resolved-hidden-default
  test("MASTER_ADMIN resolves manual review after verification and default list hides it", async ({ page }) => {
    const master = await createStaff(Role.MASTER_ADMIN);
    const client = await createClient();
    const { reconciliationCase } = await createManualReviewCase(client.id);

    await signInAdmin(page, master.credentials);
    const response = await page.request.post(
      `/api/admin/gift-cards/reconciliation/${encodeURIComponent(reconciliationCase.id)}/resolve`,
      {
        headers: {
          origin: "http://127.0.0.1:3100",
          referer: "http://127.0.0.1:3100/admin/gift-cards",
        },
        data: { note: "Verified wallet, ledger, payment, order, and redemption state." },
      },
    );

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ resolved: true });

    await page.goto("/admin/gift-cards");
    const defaultListResponse = await page.request.get("/api/admin/gift-cards/wallets");
    expect(defaultListResponse.status()).toBe(200);
    const defaultListJson = await defaultListResponse.json();
    expect(defaultListJson.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reconciliationCase.id })]),
    );

    const resolvedListResponse = await page.request.get("/api/admin/gift-cards/wallets?status=RESOLVED");
    expect(resolvedListResponse.status()).toBe(200);
    const resolvedListJson = await resolvedListResponse.json();
    expect(resolvedListJson.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: reconciliationCase.id,
          status: "RESOLVED",
          reason: "e2e_manual_review",
        }),
      ]),
    );
  });
});

