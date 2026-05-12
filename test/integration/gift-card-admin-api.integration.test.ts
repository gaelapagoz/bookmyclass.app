import "./helpers/setup-env";

import {
  CheckoutSource,
  GiftCardLedgerEntryType,
  GiftCardReconciliationStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";

import { GET as walletLookupRoute } from "../../src/app/api/admin/gift-cards/wallets/route";
import { POST as noteRoute } from "../../src/app/api/admin/gift-cards/reconciliation/[caseId]/note/route";
import { POST as resolveRoute } from "../../src/app/api/admin/gift-cards/reconciliation/[caseId]/resolve/route";
import { activateGiftCardValue, captureGiftCardRedemption, reserveGiftCardValue } from "../../src/lib/gift-cards/gift-card-wallet-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/admin/gift-cards",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

const actor = { type: "SYSTEM" as const, label: "gift-card-admin-api-test" };

function request(url: string, body?: object) {
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: sameOriginHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function routeContext(caseId: string) {
  return { params: Promise.resolve({ caseId }) };
}

async function createUser(role: Role) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `${role} ${unique}`,
      email: `${role.toLowerCase()}-${unique}@example.test`,
      role,
    },
  });
}

async function createProduct(input: { productType: ProductType; amountMinor: number }) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `${input.productType} ${unique}`,
      slug: `gift-card-admin-${input.productType.toLowerCase()}-${unique}`,
      productType: input.productType,
      isActive: true,
      isArchived: false,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `gift-card-admin-price-${unique}`,
      name: `${input.productType} Price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.amountMinor,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function activateWallet(clientId: string, amountMinor = 10_000) {
  const { product, price } = await createProduct({ productType: ProductType.GIFT_CARD, amountMinor });
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
    },
  });
  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: amountMinor,
      lineSubtotalAmountMinor: amountMinor,
      lineTotalAmountMinor: amountMinor,
      currencyCode: "EUR",
    },
  });

  return activateGiftCardValue({
    actor,
    clientId,
    orderId: order.id,
    orderItemId: orderItem.id,
    amountMinor,
    idempotencyKey: `gift-card:activation:orderItem:${orderItem.id}`,
  });
}

async function createCapturedRedemptionCase(clientId: string) {
  const activation = await activateWallet(clientId, 10_000);
  const { product, price } = await createProduct({ productType: ProductType.MERCHANDISE, amountMinor: 2_500 });
  const order = await prisma.order.create({
    data: {
      clientId,
      subtotalAmountMinor: 2_500,
      totalAmountMinor: 2_500,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      items: {
        create: {
          productId: product.id,
          priceId: price.id,
          productNameSnapshot: product.name,
          priceNameSnapshot: price.name,
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
      status: PaymentStatus.PENDING,
      method: PaymentMethod.GIFT_CARD,
      provider: PaymentProvider.INTERNAL,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: 2_500,
      currencyCode: "EUR",
    },
  });
  const reservation = await reserveGiftCardValue({
    actor,
    clientId,
    orderId: order.id,
    amountMinor: 2_500,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    idempotencyKey: `gift-card:reserve:order:${order.id}`,
  });
  await captureGiftCardRedemption({
    actor,
    redemptionId: reservation.redemption.id,
    paymentId: payment.id,
    idempotencyKey: `gift-card:capture:redemption:${reservation.redemption.id}`,
  });
  await prisma.giftCardLedgerEntry.updateMany({
    where: { walletId: activation.wallet.id, entryType: "ACTIVATION" },
    data: { happenedAt: new Date("2026-01-01T10:00:00.000Z") },
  });
  await prisma.giftCardLedgerEntry.updateMany({
    where: { walletId: activation.wallet.id, entryType: "RESERVE" },
    data: { happenedAt: new Date("2026-01-01T10:01:00.000Z") },
  });
  await prisma.giftCardLedgerEntry.updateMany({
    where: { walletId: activation.wallet.id, entryType: "CAPTURE" },
    data: { happenedAt: new Date("2026-01-01T10:02:00.000Z") },
  });
  const [updatedOrder, updatedPayment] = await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID } }),
    prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.SUCCEEDED } }),
  ]);
  const reconciliationCase = await prisma.giftCardReconciliationCase.create({
    data: {
      orderId: updatedOrder.id,
      clientId,
      walletId: activation.wallet.id,
      redemptionId: reservation.redemption.id,
      paymentId: updatedPayment.id,
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      reason: "test_manual_review",
      idempotencyKey: `gift-card:admin-test:${updatedOrder.id}`,
      metadata: {},
    },
  });

  return { wallet: activation.wallet, order: updatedOrder, payment: updatedPayment, reconciliationCase };
}

describe("gift-card admin visibility and permissions", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockResolvedValue(null);
  });

  it("allows ADMIN to read wallet balance, ledger history, redemptions, and open reconciliation cases", async () => {
    const admin = await createUser(Role.ADMIN);
    const client = await createUser(Role.CLIENT);
    const { reconciliationCase } = await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id } } as never);

    const response = await walletLookupRoute(
      request(`http://localhost/api/admin/gift-cards/wallets?clientId=${client.id}&pageSize=1`),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.wallet).toMatchObject({
      balanceMinor: 7_500,
      reservedAmountMinor: 0,
      availableBalanceMinor: 7_500,
      currencyCode: "EUR",
    });
    expect(body.ledgerEntries).toHaveLength(1);
    expect(body.ledgerEntries[0]).not.toHaveProperty("idempotencyKey");
    expect(body.ledgerEntries[0]).not.toHaveProperty("payloadHash");
    expect(body.ledgerEntries[0]).not.toHaveProperty("metadata");
    expect(body.pagination.totalItems).toBe(3);
    expect(body.redemptions).toEqual([expect.objectContaining({ status: "CAPTURED" })]);
    expect(body.redemptions[0]).not.toHaveProperty("idempotencyKey");
    expect(body.redemptions[0]).not.toHaveProperty("payloadHash");
    expect(body.reconciliationCases).toEqual([
      expect.objectContaining({ id: reconciliationCase.id, status: "MANUAL_REVIEW" }),
    ]);
    expect(body.reconciliationCases[0]).not.toHaveProperty("idempotencyKey");
    expect(body.reconciliationCases[0]).not.toHaveProperty("payloadHash");
    expect(body.reconciliationCases[0]).not.toHaveProperty("metadata");
  });

  it("rejects unauthenticated and CLIENT access for wallet lookup, note, and resolve routes", async () => {
    const client = await createUser(Role.CLIENT);
    const { reconciliationCase } = await createCapturedRedemptionCase(client.id);

    const unauthWallet = await walletLookupRoute(
      request(`http://localhost/api/admin/gift-cards/wallets?clientId=${client.id}`),
    );
    expect(unauthWallet.status).toBe(401);

    const unauthNote = await noteRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/note`, {
        note: "No session.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(unauthNote.status).toBe(401);

    const unauthResolve = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "No session.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(unauthResolve.status).toBe(401);

    vi.mocked(auth).mockResolvedValue({ user: { id: client.id } } as never);
    const clientWallet = await walletLookupRoute(
      request(`http://localhost/api/admin/gift-cards/wallets?clientId=${client.id}`),
    );
    expect(clientWallet.status).toBe(403);

    const clientNote = await noteRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/note`, {
        note: "Client forbidden.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(clientNote.status).toBe(403);

    const clientResolve = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Client forbidden.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(clientResolve.status).toBe(403);
  });

  it("returns ledger history in newest-first paginated order", async () => {
    const admin = await createUser(Role.ADMIN);
    const client = await createUser(Role.CLIENT);
    await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id } } as never);

    const firstPage = await walletLookupRoute(
      request(`http://localhost/api/admin/gift-cards/wallets?clientId=${client.id}&pageSize=2&page=1`),
    );
    const secondPage = await walletLookupRoute(
      request(`http://localhost/api/admin/gift-cards/wallets?clientId=${client.id}&pageSize=2&page=2`),
    );

    const firstBody = await firstPage.json();
    const secondBody = await secondPage.json();
    expect(firstBody.ledgerEntries.map((entry: { entryType: string }) => entry.entryType)).toEqual(["CAPTURE", "RESERVE"]);
    expect(secondBody.ledgerEntries.map((entry: { entryType: string }) => entry.entryType)).toEqual(["ACTIVATION"]);
  });

  it("allows ADMIN to add a non-financial note without changing wallet balance or payment state", async () => {
    const admin = await createUser(Role.ADMIN);
    const client = await createUser(Role.CLIENT);
    const { wallet, payment, reconciliationCase } = await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id } } as never);

    const response = await noteRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/note`, {
        note: "Operations reviewed; no financial changes made.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      case: { resolutionNote: "Operations reviewed; no financial changes made.", status: "MANUAL_REVIEW" },
      metadata: {
        resolutionNoteDisclaimer: "Operational note only. This does not adjust wallet balance or payment state.",
      },
    });
    await expect(prisma.giftCardWallet.findUniqueOrThrow({ where: { id: wallet.id } })).resolves.toMatchObject({
      balanceMinor: 7_500,
    });
    await expect(prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
  });

  it("rejects ADMIN resolve attempts with 403", async () => {
    const admin = await createUser(Role.ADMIN);
    const client = await createUser(Role.CLIENT);
    const { wallet, reconciliationCase } = await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: admin.id } } as never);

    const response = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Resolve after review.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "GIFT_CARD_MASTER_ADMIN_REQUIRED" });
    await expect(prisma.giftCardWallet.findUniqueOrThrow({ where: { id: wallet.id } })).resolves.toMatchObject({
      balanceMinor: 7_500,
    });
  });

  it("rejects MASTER_ADMIN resolve when consistency verification fails", async () => {
    const master = await createUser(Role.MASTER_ADMIN);
    const client = await createUser(Role.CLIENT);
    const { wallet, reconciliationCase } = await createCapturedRedemptionCase(client.id);
    await prisma.giftCardWallet.update({ where: { id: wallet.id }, data: { balanceMinor: 99_999 } });
    vi.mocked(auth).mockResolvedValue({ user: { id: master.id } } as never);

    const response = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Resolve after review.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_RECONCILIATION_CONSISTENCY_FAILED",
      verification: { ok: false, reasons: expect.arrayContaining(["WALLET_BALANCE_MISMATCH"]) },
    });
  });

  it("rejects MASTER_ADMIN resolve when order/payment status is inconsistent", async () => {
    const master = await createUser(Role.MASTER_ADMIN);
    const client = await createUser(Role.CLIENT);
    const { order, reconciliationCase } = await createCapturedRedemptionCase(client.id);
    await prisma.order.update({ where: { id: order.id }, data: { status: OrderStatus.PLACED } });
    vi.mocked(auth).mockResolvedValue({ user: { id: master.id } } as never);

    const response = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Resolve after review.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_RECONCILIATION_CONSISTENCY_FAILED",
      verification: {
        ok: false,
        reasons: expect.arrayContaining([
          "ORDER_STATUS_INVALID_FOR_SUCCEEDED_PAYMENT",
          "CAPTURED_REDEMPTION_ORDER_NOT_PAID",
        ]),
      },
    });
  });

  it("rejects MASTER_ADMIN resolve when required capture ledger entry is missing", async () => {
    const master = await createUser(Role.MASTER_ADMIN);
    const client = await createUser(Role.CLIENT);
    const { reconciliationCase } = await createCapturedRedemptionCase(client.id);
    await prisma.giftCardLedgerEntry.deleteMany({
      where: { redemptionId: reconciliationCase.redemptionId, entryType: GiftCardLedgerEntryType.CAPTURE },
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: master.id } } as never);

    const response = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Resolve after review.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_RECONCILIATION_CONSISTENCY_FAILED",
      verification: { ok: false, reasons: expect.arrayContaining(["REDEMPTION_CAPTURE_LEDGER_MISSING"]) },
    });
  });

  it("returns deterministic resolve errors for resolved, non-manual, and missing cases", async () => {
    const master = await createUser(Role.MASTER_ADMIN);
    const client = await createUser(Role.CLIENT);
    const { reconciliationCase } = await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: master.id } } as never);

    await prisma.giftCardReconciliationCase.update({
      where: { id: reconciliationCase.id },
      data: { status: GiftCardReconciliationStatus.RESOLVED },
    });
    const resolved = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Already resolved.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(resolved.status).toBe(409);
    await expect(resolved.json()).resolves.toMatchObject({ code: "GIFT_CARD_RECONCILIATION_ALREADY_RESOLVED" });

    await prisma.giftCardReconciliationCase.update({
      where: { id: reconciliationCase.id },
      data: { status: GiftCardReconciliationStatus.OPEN },
    });
    const nonManual = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Not manual.",
      }),
      routeContext(reconciliationCase.id),
    );
    expect(nonManual.status).toBe(409);
    await expect(nonManual.json()).resolves.toMatchObject({ code: "GIFT_CARD_MANUAL_REVIEW_REQUIRED" });

    const missing = await resolveRoute(
      request("http://localhost/api/admin/gift-cards/reconciliation/missing-case/resolve", {
        note: "Missing.",
      }),
      routeContext("missing-case"),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: "GIFT_CARD_RECONCILIATION_NOT_FOUND" });
  });

  it("allows MASTER_ADMIN to resolve MANUAL_REVIEW after verification and hides resolved cases by default", async () => {
    const master = await createUser(Role.MASTER_ADMIN);
    const client = await createUser(Role.CLIENT);
    const { reconciliationCase } = await createCapturedRedemptionCase(client.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: master.id } } as never);

    const response = await resolveRoute(
      request(`http://localhost/api/admin/gift-cards/reconciliation/${reconciliationCase.id}/resolve`, {
        note: "Verified ledger, wallet, payment, and order state.",
      }),
      routeContext(reconciliationCase.id),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resolved: true,
      case: { status: "RESOLVED", resolutionNote: "Verified ledger, wallet, payment, and order state." },
      metadata: {
        resolutionNoteDisclaimer: "Operational note only. This does not adjust wallet balance or payment state.",
      },
    });

    const defaultList = await walletLookupRoute(request("http://localhost/api/admin/gift-cards/wallets"));
    await expect(defaultList.json()).resolves.toMatchObject({ items: [] });

    const resolvedList = await walletLookupRoute(
      request("http://localhost/api/admin/gift-cards/wallets?status=RESOLVED"),
    );
    await expect(resolvedList.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: reconciliationCase.id, status: "RESOLVED" })],
    });
  });
});
