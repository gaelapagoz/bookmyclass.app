import { expect, test } from "@playwright/test";
import {
  GiftCardCodeStatus,
  GiftCardLedgerEntryType,
  GiftCardRedemptionStatus,
  GiftCardWalletStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
  UserCreatedVia,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import prisma from "../../src/lib/db";
import { signInClient } from "./support/auth";
import {
  completeStripeCheckoutForTest,
  getCapturedEmailsForTest,
  clearCapturedEmailsForTest,
} from "./support/e2e-api";

const password = "StoreE2EPass123!";
const E2E_GIFT_CARD_CODE = "AABBCCDD-EEFF0011-22334455-66778899";

function unique(prefix: string) {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

function hashGiftCardCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function createVerifiedClient() {
  const email = `${unique("store.client")}@example.test`;
  const passwordHash = await hash(password, 12);
  const now = new Date();
  const user = await prisma.user.create({
    data: {
      name: "Store E2E Client",
      email,
      passwordHash,
      role: Role.CLIENT,
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

async function createCheckoutReadyGiftCardProduct(amountMinor: number) {
  const slug = unique("store-e2e-gc");
  const product = await prisma.product.create({
    data: {
      name: `Gift Card E2E ${amountMinor / 100} EUR`,
      slug,
      productType: ProductType.GIFT_CARD,
      description: "Studio gift card for future purchases.",
      isActive: true,
      isArchived: false,
      sortOrder: 900,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      name: `Gift Card E2E ${amountMinor / 100} EUR`,
      lookupKey: `${slug}-price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      stripePriceId: `price_e2e_${slug}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function createMerchandiseProduct(amountMinor: number) {
  const slug = unique("store-e2e-merch");
  const product = await prisma.product.create({
    data: {
      name: `Studio Tote Bag E2E`,
      slug,
      productType: ProductType.MERCHANDISE,
      description: "Pickup at studio.",
      isActive: true,
      isArchived: false,
      sortOrder: 910,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      name: `Studio Tote Bag E2E`,
      lookupKey: `${slug}-price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      stripePriceId: `price_e2e_${slug}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function seedWalletWithBalance(clientId: string, balanceMinor: number) {
  return prisma.giftCardWallet.create({
    data: {
      clientId,
      currencyCode: "EUR",
      balanceMinor,
      status: GiftCardWalletStatus.ACTIVE,
    },
  });
}

async function seedActiveLedgerEntry(
  walletId: string,
  clientId: string,
  amountMinor: number,
  orderId: string,
  orderItemId: string,
) {
  return prisma.giftCardLedgerEntry.create({
    data: {
      walletId,
      clientId,
      entryType: GiftCardLedgerEntryType.ACTIVATION,
      amountMinor,
      currencyCode: "EUR",
      orderId,
      orderItemId,
      idempotencyKey: `e2e:activation:store:${orderItemId}`,
      payloadHash: `e2e-activation-${orderItemId}`,
      happenedAt: new Date(),
    },
  });
}

async function cleanupStoreTest(userId: string, productIds: string[]) {
  await prisma.giftCardCode.deleteMany({ where: { purchasedById: userId } });
  await prisma.giftCardLedgerEntry.deleteMany({ where: { clientId: userId } });
  await prisma.giftCardRedemption.deleteMany({ where: { clientId: userId } });
  await prisma.giftCardWallet.deleteMany({ where: { clientId: userId } });
  await prisma.cartCheckoutIdempotency.deleteMany({ where: { userId } });
  await prisma.payment.deleteMany({ where: { order: { clientId: userId } } });
  await prisma.orderItem.deleteMany({ where: { order: { clientId: userId } } });
  await prisma.order.deleteMany({ where: { clientId: userId } });
  if (productIds.length > 0) {
    await prisma.price.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.user.delete({ where: { id: userId } });
}

test.describe("Store page", () => {
  // @store @covers store-page-renders-products
  test("renders active gift-card and merchandise products with pickup wording @store", async ({ page }) => {
    const { product: gcProduct } = await createCheckoutReadyGiftCardProduct(2_500);
    const { product: merchProduct } = await createMerchandiseProduct(2_200);

    try {
      await page.goto("/store");
      await expect(page.getByRole("heading", { name: "Studio Store" })).toBeVisible();
      await expect(page.getByText("Gift Cards")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Merchandise" })).toBeVisible();
      await expect(page.getByText(gcProduct.name)).toBeVisible();
      await expect(page.getByText(merchProduct.name)).toBeVisible();
      const pickupLabels = page.getByTestId("pickup-wording");
      await expect(pickupLabels.first()).toBeVisible();
      await expect(pickupLabels.first()).toHaveText("Pickup at studio.");
    } finally {
      await prisma.price.deleteMany({ where: { productId: { in: [gcProduct.id, merchProduct.id] } } });
      await prisma.product.deleteMany({ where: { id: { in: [gcProduct.id, merchProduct.id] } } });
    }
  });
});

test.describe("Gift-card purchase from /store", () => {
  // @store
  // @covers store-gift-card-purchase-flow
  // @covers store-gift-card-issuance-email-sent
  // @covers store-full-wallet-gift-card-purchase-flow

  test("gift-card purchase from store → success page → GiftCardCode issued and issuance email sent @store", async ({ page, request }) => {
    const { user, credentials } = await createVerifiedClient();
    const { product: gcProduct } = await createCheckoutReadyGiftCardProduct(2_500);

    await clearCapturedEmailsForTest(request);

    try {
      await signInClient(page, credentials);
      await page.goto("/store");

      await expect(page.getByText(gcProduct.name)).toBeVisible();
      await page.getByRole("listitem").filter({ hasText: gcProduct.name }).getByRole("button", { name: "Add to Cart" }).click();

      await page.goto("/cart");
      await expect(page.getByRole("heading", { name: gcProduct.name })).toBeVisible();
      await page.getByRole("button", { name: "Checkout" }).click();

      await page.waitForURL(/\/store\/success\?session_id=/, { timeout: 20_000 });
      const checkoutSessionId = new URL(page.url()).searchParams.get("session_id");
      expect(checkoutSessionId).toBeTruthy();

      await completeStripeCheckoutForTest(request, checkoutSessionId!);

      await page.goto(`/store/success?session_id=${checkoutSessionId}`);
      await expect(page.getByRole("heading", { name: "Purchase Confirmed" })).toBeVisible({ timeout: 15_000 });

      // Purchase issues a GiftCardCode — wallet is NOT credited at purchase time
      const issuedCode = await prisma.giftCardCode.findFirst({
        where: { purchasedById: user.id },
        select: { status: true, amountMinor: true },
      });
      expect(issuedCode).not.toBeNull();
      expect(issuedCode!.status).toBe(GiftCardCodeStatus.ISSUED);
      expect(issuedCode!.amountMinor).toBe(2_500);

      // Issuance email captured in test outbox
      const emails = await getCapturedEmailsForTest(request);
      const issuanceEmail = emails.find(
        (e) => e.to.includes(credentials.email) && e.context === "gift-card-issuance",
      );
      expect(issuanceEmail).toBeDefined();
    } finally {
      await cleanupStoreTest(user.id, [gcProduct.id]);
    }
  });

  // @store @covers store-full-wallet-gift-card-purchase-flow
  test("full-wallet gift-card purchase → /store/success?orderId= (no Stripe redirect) @store", async ({ page }) => {
    const { user, credentials } = await createVerifiedClient();
    const { product: gcProduct } = await createCheckoutReadyGiftCardProduct(2_000);

    await prisma.giftCardWallet.create({
      data: {
        clientId: user.id,
        currencyCode: "EUR",
        balanceMinor: 5_000,
        status: GiftCardWalletStatus.ACTIVE,
      },
    });

    try {
      await signInClient(page, credentials);
      await page.goto("/store");

      await expect(page.getByText(gcProduct.name)).toBeVisible();
      await page.getByRole("listitem").filter({ hasText: gcProduct.name }).getByRole("button", { name: "Add to Cart" }).click();

      await page.goto("/cart");
      await expect(page.getByRole("heading", { name: gcProduct.name })).toBeVisible();

      await expect(page.getByTestId("wallet-controls")).toBeVisible({ timeout: 8_000 });
      await page.getByTestId("wallet-use-all").click();
      await page.getByTestId("wallet-apply").click();
      await expect(page.getByTestId("wallet-applied-amount")).toBeVisible();

      await page.getByRole("button", { name: "Checkout" }).click();

      await expect(page.getByRole("heading", { name: "Purchase Confirmed" })).toBeVisible({ timeout: 15_000 });
      expect(page.url()).toContain("/store/success");
      expect(page.url()).toContain("orderId=");
      expect(page.url()).not.toContain("session_id");
    } finally {
      await cleanupStoreTest(user.id, [gcProduct.id]);
    }
  });
});

test.describe("Dashboard wallet balance breakdown", () => {
  // @store @covers store-wallet-balance-breakdown
  test("shows correct available and reserved balance when a reservation is active @store", async ({ page }) => {
    const { user, credentials } = await createVerifiedClient();
    const { product: gcProduct, price: gcPrice } = await createCheckoutReadyGiftCardProduct(5_000);

    const order = await prisma.order.create({
      data: {
        clientId: user.id,
        subtotalAmountMinor: 5_000,
        totalAmountMinor: 5_000,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        items: {
          create: {
            productId: gcProduct.id,
            priceId: gcPrice.id,
            productNameSnapshot: gcProduct.name,
            priceNameSnapshot: gcPrice.name,
            unitAmountMinor: 5_000,
            lineSubtotalAmountMinor: 5_000,
            lineTotalAmountMinor: 5_000,
            currencyCode: "EUR",
          },
        },
      },
      include: { items: true },
    });

    const wallet = await seedWalletWithBalance(user.id, 5_000);
    await seedActiveLedgerEntry(wallet.id, user.id, 5_000, order.id, order.items[0]!.id);

    const pendingOrder = await prisma.order.create({
      data: {
        clientId: user.id,
        subtotalAmountMinor: 2_500,
        totalAmountMinor: 2_500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });

    await prisma.giftCardRedemption.create({
      data: {
        walletId: wallet.id,
        clientId: user.id,
        orderId: pendingOrder.id,
        status: GiftCardRedemptionStatus.RESERVED,
        reservedAmountMinor: 2_500,
        capturedAmountMinor: 0,
        currencyCode: "EUR",
        idempotencyKey: `e2e:reserve:dashboard:${pendingOrder.id}`,
        payloadHash: `e2e-reserve-${pendingOrder.id}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });

    try {
      await signInClient(page, credentials);
      await page.goto("/dashboard/wallet");

      await expect(page.getByTestId("settled-balance")).toHaveText(/50/);
      await expect(page.getByTestId("available-balance")).toHaveText(/25/);
      await expect(page.getByTestId("reserved-balance")).toHaveText(/25/);
      await expect(page.getByText(/reserved amount is held/i)).toBeVisible();
    } finally {
      await cleanupStoreTest(user.id, [gcProduct.id]);
    }
  });
});

test.describe("Gift-card code redemption", () => {
  // @store @covers store-gift-card-redeem-code
  test("client redeems a valid gift card code → wallet balance increases @store", async ({ page }) => {
    const { user, credentials } = await createVerifiedClient();
    const { product: gcProduct, price: gcPrice } = await createCheckoutReadyGiftCardProduct(2_500);

    const order = await prisma.order.create({
      data: {
        clientId: user.id,
        subtotalAmountMinor: 2_500,
        totalAmountMinor: 2_500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        items: {
          create: {
            productId: gcProduct.id,
            priceId: gcPrice.id,
            productNameSnapshot: gcProduct.name,
            priceNameSnapshot: gcPrice.name,
            unitAmountMinor: 2_500,
            lineSubtotalAmountMinor: 2_500,
            lineTotalAmountMinor: 2_500,
            currencyCode: "EUR",
          },
        },
      },
      include: { items: true },
    });

    await prisma.giftCardCode.create({
      data: {
        orderId: order.id,
        orderItemId: order.items[0]!.id,
        purchasedById: user.id,
        codeHash: hashGiftCardCode(E2E_GIFT_CARD_CODE),
        maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-66778899",
        amountMinor: 2_500,
        currencyCode: "EUR",
        status: GiftCardCodeStatus.ISSUED,
        issuedAt: new Date(),
      },
    });

    try {
      await signInClient(page, credentials);
      await page.goto("/dashboard/wallet");

      await expect(page.getByTestId("gift-card-code-input")).toBeVisible();
      await page.getByTestId("gift-card-code-input").fill(E2E_GIFT_CARD_CODE);
      await page.getByTestId("redeem-submit").click();

      await expect(page.getByTestId("redeem-success")).toBeVisible({ timeout: 10_000 });
      const successText = await page.getByTestId("redeem-success").textContent();
      expect(successText).toMatch(/25/);
    } finally {
      await cleanupStoreTest(user.id, [gcProduct.id]);
    }
  });
});
