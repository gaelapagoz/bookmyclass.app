import { expect, test } from "@playwright/test";
import { PriceType, ProductType, Role, StripeSyncStatus } from "@prisma/client";
import prisma from "../../src/lib/db";
import { signInAdmin, signInAdminSession } from "./support/auth";
import { E2E_TEST_SECRET, SEEDED_ADMIN } from "./support/constants";

function unique(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function testHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-e2e-test-secret": E2E_TEST_SECRET,
  };
}

async function openGiftCardEditByName(page: import("@playwright/test").Page, name: string) {
  await page.goto("/admin/store/gift-cards");

  for (let pageIndex = 0; pageIndex < 8; pageIndex += 1) {
    const row = page.locator("tr").filter({ hasText: name }).first();
    if ((await row.count()) > 0) {
      await row.getByRole("link", { name: "Edit" }).click();
      return;
    }

    const nextLink = page.getByRole("link", { name: "Next" });
    if ((await nextLink.count()) === 0) {
      break;
    }

    await Promise.all([page.waitForLoadState("networkidle"), nextLink.click()]);
  }

  throw new Error(`Could not locate gift-card row for "${name}" across pagination.`);
}

async function createStoreProductWithPrice(input: {
  name: string;
  productType: ProductType;
  unitAmountMinor: number;
  stripePriceId: string | null;
  stripeSyncStatus: StripeSyncStatus;
  isActive?: boolean;
  isArchived?: boolean;
}) {
  const slug = unique(
    input.productType === ProductType.GIFT_CARD
      ? "e2e-admin-store-gc"
      : "e2e-admin-store-merch",
  );
  const product = await prisma.product.create({
    data: {
      name: input.name,
      slug,
      description:
        input.productType === ProductType.GIFT_CARD
          ? "Studio gift card for future purchases."
          : "Pickup at studio.",
      productType: input.productType,
      isActive: input.isActive ?? true,
      isArchived: input.isArchived ?? false,
      sortOrder: 9990,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${slug}-price`,
      name: `${input.name} Price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.unitAmountMinor,
      stripePriceId: input.stripePriceId,
      stripeSyncStatus: input.stripeSyncStatus,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function cleanupProductsByPrefix(prefixes: string[]) {
  const products = await prisma.product.findMany({
    where: {
      OR: prefixes.map((prefix) => ({ slug: { startsWith: prefix } })),
    },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  if (productIds.length === 0) return;
  await prisma.price.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}

async function cleanupByNames(names: string[]) {
  const products = await prisma.product.findMany({
    where: { name: { in: names } },
    select: { id: true },
  });
  const productIds = products.map((p) => p.id);
  if (productIds.length === 0) return;
  await prisma.price.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}

async function seedWalletReviewCaseForAdminReadonly() {
  const client = await prisma.user.create({
    data: {
      name: "E2E Admin Store Wallet Client",
      email: `${unique("e2e.admin.store.wallet")}@bookmyclass.app`,
      role: Role.CLIENT,
      isActive: true,
    },
  });

  const wallet = await prisma.giftCardWallet.create({
    data: {
      clientId: client.id,
      currencyCode: "EUR",
      balanceMinor: 5_000,
      status: "ACTIVE",
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: 2_000,
      totalAmountMinor: 2_000,
      currencyCode: "EUR",
      status: "PAID",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: "SUCCEEDED",
      method: "GIFT_CARD",
      provider: "INTERNAL",
      amountMinor: 2_000,
      currencyCode: "EUR",
    },
  });

  const redemption = await prisma.giftCardRedemption.create({
    data: {
      walletId: wallet.id,
      clientId: client.id,
      orderId: order.id,
      status: "CAPTURED",
      reservedAmountMinor: 2_000,
      capturedAmountMinor: 2_000,
      currencyCode: "EUR",
      idempotencyKey: unique("e2e-admin-store-wallet-redemption"),
      payloadHash: unique("e2e-admin-store-wallet-payload"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const reviewCase = await prisma.giftCardReconciliationCase.create({
    data: {
      orderId: order.id,
      clientId: client.id,
      walletId: wallet.id,
      redemptionId: redemption.id,
      paymentId: payment.id,
      status: "MANUAL_REVIEW",
      reason: "e2e_admin_store_wallet_readonly",
      idempotencyKey: unique("e2e-admin-store-wallet-case"),
      metadata: {},
    },
  });

  return { clientId: client.id, reviewCaseId: reviewCase.id };
}

async function cleanupWalletReviewCase(clientId: string) {
  await prisma.giftCardReconciliationCase.deleteMany({ where: { clientId } });
  await prisma.giftCardLedgerEntry.deleteMany({ where: { clientId } });
  await prisma.giftCardRedemption.deleteMany({ where: { clientId } });
  await prisma.giftCardWallet.deleteMany({ where: { clientId } });
  await prisma.payment.deleteMany({ where: { order: { clientId } } });
  await prisma.orderItem.deleteMany({ where: { order: { clientId } } });
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { id: clientId } });
}

test.describe("admin store catalog coverage", () => {
  test.describe.configure({ mode: "serial" });

  // @covers admin-store-catalog-nav
  // @covers admin-store-merchandise-list
  // @covers admin-store-gift-card-catalog-list
  test("admin catalog nav and store lists are visible and meaningful", async ({ page }) => {
    const merchName = `E2E Admin Merch ${Date.now()}`;
    const giftName = `E2E Admin Gift ${Date.now()}`;
    const merch = await createStoreProductWithPrice({
      name: merchName,
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2_200,
      stripePriceId: `price_e2e_admin_store_merch_${Date.now()}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });
    const gift = await createStoreProductWithPrice({
      name: giftName,
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 2_500,
      stripePriceId: `price_e2e_admin_store_gc_${Date.now()}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });

    try {
      await signInAdminSession(page, SEEDED_ADMIN, {
        callbackUrl: "http://127.0.0.1:3100/admin/store",
      });
      await page.goto("/admin/store");
      await expect(page.getByTestId("admin-nav-list")).toContainText("Catalog");
      await expect(page.getByRole("heading", { name: "Store" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Merchandising" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Gift Cards" })).toBeVisible();

      await page.goto("/admin/store/merchandise");
      await expect(page.getByRole("heading", { name: "Store: Merchandise" })).toBeVisible();
      await expect(page.getByText(merchName)).toBeVisible();
      await expect(page.getByText("Ready").first()).toBeVisible();

      await page.goto("/admin/store/gift-cards");
      await expect(page.getByRole("heading", { name: "Store: Gift Cards" })).toBeVisible();
      await expect(page.getByText(giftName)).toBeVisible();
      await expect(page.getByText("Ready").first()).toBeVisible();
    } finally {
      await prisma.price.deleteMany({ where: { productId: { in: [merch.product.id, gift.product.id] } } });
      await prisma.product.deleteMany({ where: { id: { in: [merch.product.id, gift.product.id] } } });
    }
  });

  // @covers admin-store-merchandise-create-edit-archive
  test("admin can create, edit, and archive merchandise through UI", async ({ page }) => {
    const createdName = `E2E UI Merch ${Date.now()}`;
    const updatedName = `${createdName} Updated`;

    try {
      await signInAdmin(page, SEEDED_ADMIN);
      await page.goto("/admin/store/merchandise/new");
      await page.getByLabel("Name").fill(createdName);
      await page.getByLabel("Sort Order").fill("940");
      await page.getByLabel("Description").fill("Pickup at studio. E2E merchandise coverage.");
      await page.getByLabel("Price (EUR)").fill("22.00");
      await page.getByLabel("Price Label").fill(`${createdName} Label`);
      await page.getByRole("button", { name: "Save merchandise" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      await expect(page.getByText(createdName)).toBeVisible();

      await page.goto("/admin/store/merchandise");
      const row = page.locator("tr").filter({ hasText: createdName }).first();
      await expect(row).toBeVisible();
      await row.getByRole("link", { name: "Edit" }).click();

      await page.getByLabel("Name").fill(updatedName);
      await page.getByLabel("Description").fill("Pickup at studio. Updated by E2E.");
      await page.getByLabel("Price (EUR)").fill("24.00");
      await page.getByRole("button", { name: "Update merchandise" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      await expect(page.getByText(updatedName)).toBeVisible();

      await page.goto("/admin/store/merchandise");
      const updatedRow = page.locator("tr").filter({ hasText: updatedName }).first();
      await updatedRow.getByRole("link", { name: "Edit" }).click();
      await page.getByRole("button", { name: "Archive merchandise" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      const archivedRow = page.locator("tr").filter({ hasText: updatedName }).first();
      await expect(archivedRow).toContainText("Archived");
    } finally {
      await cleanupByNames([createdName, updatedName]);
      await cleanupProductsByPrefix(["e2e-admin-store-merch"]);
    }
  });

  // @covers admin-store-gift-card-create-edit-archive
  // @covers admin-store-gift-card-checkout-requires-stripe-sync
  test("admin gift-card CRUD and checkout readiness gating are enforced", async ({ page }) => {
    const createdName = `E2E UI Gift ${Date.now()}`;
    const updatedName = `${createdName} Updated`;
    const unsyncedName = `E2E Unsynced Gift ${Date.now()}`;
    const unsynced = await createStoreProductWithPrice({
      name: unsyncedName,
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 3_500,
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });

    try {
      await signInAdmin(page, SEEDED_ADMIN);
      await page.goto("/admin/store/gift-cards/new");
      await page.getByLabel("Name").fill(createdName);
      await page.getByLabel("Sort Order").fill("945");
      await page.getByLabel("Description").fill("Studio gift card for future purchases.");
      await page.getByLabel("Amount (EUR)").fill("25.00");
      await page.getByLabel("Price Label").fill(`${createdName} Label`);
      await page.getByRole("button", { name: "Save gift card" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      await expect(page.getByText(createdName)).toBeVisible();

      await page.goto("/admin/store/gift-cards");
      await expect(page.getByText(unsyncedName)).toBeVisible();
      await expect(page.locator("tr").filter({ hasText: unsyncedName })).toContainText(/Needs Stripe sync|Stripe sync pending|Not ready/i);

      await page.goto("/store");
      await expect(page.getByText(unsyncedName)).toHaveCount(0);

      await openGiftCardEditByName(page, createdName);

      await page.getByLabel("Name").fill(updatedName);
      await page.getByLabel("Amount (EUR)").fill("50.00");
      await page.getByRole("button", { name: "Update gift card" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      await expect(page.getByText(updatedName)).toBeVisible();

      await openGiftCardEditByName(page, updatedName);
      await page.getByRole("button", { name: "Archive gift card" }).click();

      await expect(page).toHaveURL(/\/admin\/store$/);
      const archivedRow = page.locator("tr").filter({ hasText: updatedName }).first();
      await expect(archivedRow).toContainText("Archived");

      await page.goto("/store");
      await expect(page.getByText(updatedName)).toHaveCount(0);
    } finally {
      await prisma.price.deleteMany({ where: { productId: unsynced.product.id } });
      await prisma.product.deleteMany({ where: { id: unsynced.product.id } });
      await cleanupByNames([createdName, updatedName, unsyncedName]);
      await cleanupProductsByPrefix(["e2e-admin-store-gc"]);
    }
  });

  // @covers admin-store-live-price-rejects-test-id
  // @covers admin-store-live-price-rejects-missing-id
  test("live runtime readiness rejects test Stripe IDs and missing Stripe IDs", async ({ request }) => {
    const testIdResponse = await request.post("/api/test/e2e/store/live-readiness", {
      headers: testHeaders(),
      data: {
        stripePriceId: "price_test_12345",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
      },
    });
    expect(testIdResponse.ok()).toBeTruthy();
    const testIdPayload = (await testIdResponse.json()) as {
      allowedForLiveRuntime: boolean;
      checkoutReadyForLiveRuntime: boolean;
    };
    expect(testIdPayload.allowedForLiveRuntime).toBe(false);
    expect(testIdPayload.checkoutReadyForLiveRuntime).toBe(false);

    const missingIdResponse = await request.post("/api/test/e2e/store/live-readiness", {
      headers: testHeaders(),
      data: {
        stripePriceId: null,
        stripeSyncStatus: StripeSyncStatus.SYNCED,
      },
    });
    expect(missingIdResponse.ok()).toBeTruthy();
    const missingIdPayload = (await missingIdResponse.json()) as {
      allowedForLiveRuntime: boolean;
      checkoutReadyForLiveRuntime: boolean;
    };
    expect(missingIdPayload.allowedForLiveRuntime).toBe(false);
    expect(missingIdPayload.checkoutReadyForLiveRuntime).toBe(false);
  });

  // @covers admin-store-wallet-area-remains-readonly
  test("wallet/reconciliation area remains read-only and ADMIN cannot resolve manual review", async ({ page }) => {
    const seeded = await seedWalletReviewCaseForAdminReadonly();
    try {
      await signInAdmin(page, SEEDED_ADMIN);
      await page.goto(`/admin/gift-cards?clientId=${encodeURIComponent(seeded.clientId)}`);

      await expect(page.getByRole("heading", { name: "Gift Cards", exact: true })).toBeVisible();
      await expect(page.getByText(/€50\.00|50\.00/).first()).toBeVisible();
      await expect(page.getByText("Resolve via API after verification")).toHaveCount(0);

      const walletLookupResponse = await page.request.get(
        `/api/admin/gift-cards/wallets?clientId=${encodeURIComponent(seeded.clientId)}`,
      );
      expect(walletLookupResponse.status()).toBe(200);
      const walletLookupJson = await walletLookupResponse.json();
      expect(walletLookupJson.ledgerEntries).toEqual(expect.any(Array));
      expect(walletLookupJson.reconciliationCases).toEqual(expect.any(Array));

      const resolveResponse = await page.request.post(
        `/api/admin/gift-cards/reconciliation/${encodeURIComponent(seeded.reviewCaseId)}/resolve`,
        {
          headers: {
            origin: "http://127.0.0.1:3100",
            referer: "http://127.0.0.1:3100/admin/gift-cards",
          },
          data: { note: "ADMIN cannot resolve this reconciliation case." },
        },
      );
      expect(resolveResponse.status()).toBe(403);
      await expect(resolveResponse.json()).resolves.toMatchObject({ code: "GIFT_CARD_MASTER_ADMIN_REQUIRED" });
    } finally {
      await cleanupWalletReviewCase(seeded.clientId);
    }
  });
});
