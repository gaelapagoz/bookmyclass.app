import "./helpers/setup-env";

import {
  LoyaltyPointsLedgerEntryType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../../src/lib/db";
import {
  archiveLoyaltyRewardDefinitionByAdmin,
  getAdminLoyaltyClientDetails,
  saveLoyaltyRewardDefinitionByAdmin,
  grantManualLoyaltyPointsByAdmin,
  listAdminLoyaltyClientsByActor,
  upsertLoyaltyProgramSettingsByAdmin,
} from "../../src/lib/loyalty/loyalty-admin-service";
import {
  awardLoyaltyPointsForSettledOrder,
  expireLoyaltyPointsEntry,
  reverseLoyaltyPointsEntry,
} from "../../src/lib/loyalty/loyalty-points-service";
import {
  captureLoyaltyCreditReservation,
  getLoyaltyCreditBalance,
  listActiveLoyaltyRewards,
  redeemLoyaltyReward,
  releaseLoyaltyCreditReservation,
  reserveLoyaltyCreditValue,
} from "../../src/lib/loyalty/loyalty-redemption-service";
import { getClientLoyaltySummary, listClientLoyaltyHistory } from "../../src/lib/loyalty/loyalty-read-service";
import {
  seedProductionLoyaltyProgram,
  verifyDemoLoyaltyContract,
} from "../../prisma/seed/modes/demo";
import { resetDb } from "./helpers/reset-db";

async function createVerifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Client ${unique}`,
      email: `loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      emailVerifiedAt: new Date(),
    },
  });
}

async function createUnverifiedClient() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Unverified Loyalty Client ${unique}`,
      email: `unverified-loyalty-client-${unique}@example.test`,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: null,
      emailVerifiedAt: null,
    },
  });
}

async function createAdmin() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Admin ${unique}`,
      email: `loyalty-admin-${unique}@example.test`,
      role: Role.ADMIN,
    },
  });
}

async function createMasterAdmin() {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return prisma.user.create({
    data: {
      name: `Loyalty Master Admin ${unique}`,
      email: `loyalty-master-admin-${unique}@example.test`,
      role: Role.MASTER_ADMIN,
    },
  });
}

async function createCatalogProduct(input: {
  namePrefix: string;
  productType: ProductType;
  priceType?: PriceType;
  currencyCode?: string;
  unitAmountMinor: number;
}) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = await prisma.product.create({
    data: {
      name: `${input.namePrefix} ${unique}`,
      slug: `${input.namePrefix.toLowerCase().replace(/\s+/g, "-")}-${unique}`,
      productType: input.productType,
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${input.namePrefix.toLowerCase().replace(/\s+/g, "-")}-price-${unique}`,
      name: `${input.namePrefix} Price ${unique}`,
      priceType: input.priceType ?? PriceType.ONE_TIME,
      currencyCode: input.currencyCode ?? "EUR",
      unitAmountMinor: input.unitAmountMinor,
      isActive: true,
      isArchived: false,
    },
  });
  return { product, price };
}

async function createPaidOrder(input: {
  clientId: string;
  currencyCode?: string;
  discountAmountMinor?: number;
  giftCardAmountMinor?: number;
  lines: Array<{
    productId: string;
    priceId: string;
    unitAmountMinor: number;
    quantity?: number;
    lineDiscountAmountMinor?: number;
    productName: string;
    priceName: string;
  }>;
}) {
  const currencyCode = input.currencyCode ?? "EUR";
  const subtotal = input.lines.reduce(
    (total, line) => total + line.unitAmountMinor * (line.quantity ?? 1),
    0,
  );
  const discountAmountMinor = input.discountAmountMinor
    ?? input.lines.reduce((total, line) => total + (line.lineDiscountAmountMinor ?? 0), 0);
  const totalAmountMinor = subtotal - discountAmountMinor;
  const giftCardAmountMinor = input.giftCardAmountMinor ?? 0;
  const stripeAmountMinor = totalAmountMinor - giftCardAmountMinor;

  const order = await prisma.order.create({
    data: {
      clientId: input.clientId,
      subtotalAmountMinor: subtotal,
      discountAmountMinor,
      totalAmountMinor,
      currencyCode,
      status: OrderStatus.PAID,
    },
  });

  await prisma.orderItem.createMany({
    data: input.lines.map((line) => ({
      orderId: order.id,
      productId: line.productId,
      priceId: line.priceId,
      quantity: line.quantity ?? 1,
      productNameSnapshot: line.productName,
      priceNameSnapshot: line.priceName,
      unitAmountMinor: line.unitAmountMinor,
      lineSubtotalAmountMinor: line.unitAmountMinor * (line.quantity ?? 1),
      lineDiscountAmountMinor: line.lineDiscountAmountMinor ?? 0,
      lineTotalAmountMinor: (line.unitAmountMinor * (line.quantity ?? 1)) - (line.lineDiscountAmountMinor ?? 0),
      currencyCode,
    })),
  });

  if (giftCardAmountMinor > 0) {
    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        amountMinor: giftCardAmountMinor,
        currencyCode,
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        capturedAt: new Date("2026-06-20T10:00:00.000Z"),
      },
    });
  }

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.SUCCEEDED,
      amountMinor: stripeAmountMinor,
      currencyCode,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      capturedAt: new Date("2026-06-20T10:00:00.000Z"),
    },
  });

  return { order, payment };
}

describe("loyalty core services", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("upserts program settings, grants manual points, and exposes admin read models", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Loyalty Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });

    const program = await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "eur",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });
    const reward = await saveLoyaltyRewardDefinitionByAdmin({
      actorUserId: admin.id,
      programId: program.id,
      name: "5 EURO Reward",
      pointsRequired: 500,
      amountMinor: 500,
    });

    const grant = await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 250,
      reason: "Recovered launch-week points for a verified client.",
      idempotencyKey: "loyalty:manual-grant:admin-test",
      metadata: { source: "integration-test" },
    });

    const adminList = await listAdminLoyaltyClientsByActor({
      actorUserId: admin.id,
      currencyCode: "EUR",
      query: client.email,
    });
    const details = await getAdminLoyaltyClientDetails({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      historyLimit: 10,
    });

    expect(program.currencyCode).toBe("EUR");
    expect(program.eligibleProducts.map((entry) => entry.productId)).toEqual([eligible.product.id]);
    expect(grant.outcome).toBe("created");
    expect(reward.name).toBe("5 EURO Reward");
    expect(adminList.items).toHaveLength(1);
    expect(adminList.items[0]?.balancePoints).toBe(250);
    expect(details.summary.balancePoints).toBe(250);
    expect(details.history[0]?.entryType).toBe(LoyaltyPointsLedgerEntryType.MANUAL_GRANT);

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        actionType: { in: ["LOYALTY_PROGRAM_UPSERT", "LOYALTY_MANUAL_GRANT"] },
      },
      orderBy: { createdAt: "asc" },
    });
    expect(auditLogs).toHaveLength(3);
  });

  it("awards points from discounted eligible net after excluding gift-card funded value", async () => {
    const client = await createVerifiedClient();
    const admin = await createAdmin();
    const eligible = await createCatalogProduct({
      namePrefix: "Eligible Bottle",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_600,
    });
    const ineligible = await createCatalogProduct({
      namePrefix: "Ineligible Towel",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 4_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });

    const { order, payment } = await createPaidOrder({
      clientId: client.id,
      lines: [
        {
          productId: eligible.product.id,
          priceId: eligible.price.id,
          unitAmountMinor: 5_600,
          lineDiscountAmountMinor: 600,
          productName: eligible.product.name,
          priceName: eligible.price.name,
        },
        {
          productId: ineligible.product.id,
          priceId: ineligible.price.id,
          unitAmountMinor: 4_000,
          productName: ineligible.product.name,
          priceName: ineligible.price.name,
        },
      ],
      discountAmountMinor: 600,
      giftCardAmountMinor: 4_500,
    });

    const first = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:payment:${payment.id}`,
    });
    const replay = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:payment:${payment.id}`,
    });
    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
      limit: 10,
    });

    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("replayed");
    expect(summary.balancePoints).toBe(25);
    expect(history).toHaveLength(1);
    expect(history[0]?.entryType).toBe(LoyaltyPointsLedgerEntryType.EARN);
    expect(history[0]?.metadata).toMatchObject({
      computedEligibleAmountMinor: 5_000,
      eligibleAmountMinor: 2_500,
      giftCardFundedAmountMinor: 4_500,
    });
  });

  it("reverses and expires remaining points through ledger-safe mutations", async () => {
    const client = await createVerifiedClient();
    const admin = await createAdmin();
    const eligible = await createCatalogProduct({
      namePrefix: "Eligible Block",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 8_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });

    const { order, payment } = await createPaidOrder({
      clientId: client.id,
      lines: [
        {
          productId: eligible.product.id,
          priceId: eligible.price.id,
          unitAmountMinor: 8_000,
          productName: eligible.product.name,
          priceName: eligible.price.name,
        },
      ],
    });

    const earned = await awardLoyaltyPointsForSettledOrder({
      clientId: client.id,
      orderId: order.id,
      paymentId: payment.id,
      idempotencyKey: `loyalty:earn:${payment.id}`,
    });
    if (earned.outcome !== "created") {
      throw new Error("Expected loyalty earn mutation to create an entry.");
    }

    const reversal = await reverseLoyaltyPointsEntry({
      actor: { type: "SYSTEM", label: "chargeback-handler" },
      sourceEntryId: earned.entry.id,
      amountPoints: 30,
      reason: "Partial payment invalidation.",
      idempotencyKey: `loyalty:reversal:${earned.entry.id}`,
    });
    const expiration = await expireLoyaltyPointsEntry({
      sourceEntryId: earned.entry.id,
      idempotencyKey: `loyalty:expire:${earned.entry.id}`,
      happenedAt: new Date("2027-01-05T00:00:00.000Z"),
    });
    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "EUR",
      limit: 10,
    });

    expect(reversal.outcome).toBe("created");
    expect(expiration.outcome).toBe("created");
    expect(summary.balancePoints).toBe(0);
    expect(history.map((entry) => entry.entryType)).toEqual([
      LoyaltyPointsLedgerEntryType.EXPIRE,
      LoyaltyPointsLedgerEntryType.REVERSAL,
      LoyaltyPointsLedgerEntryType.EARN,
    ]);
  });

  it("supports non-EUR program-driven manual grants and read models", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "USD Eligible Strap",
      productType: ProductType.MERCHANDISE,
      currencyCode: "USD",
      unitAmountMinor: 2_500,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "USD",
      isActive: true,
      earningPoints: 2,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 90,
      expirationReminderDays: 14,
      eligibleProductIds: [eligible.product.id],
    });

    const grant = await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "USD",
      amountPoints: 2_500,
      reason: "Recovered USD loyalty points for cross-currency setup.",
      idempotencyKey: "loyalty:manual-grant:usd",
    });

    const summary = await getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "USD",
    });
    const history = await listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: client.id },
      clientId: client.id,
      currencyCode: "USD",
      limit: 10,
    });
    const adminList = await listAdminLoyaltyClientsByActor({
      actorUserId: admin.id,
      currencyCode: "USD",
      query: client.email,
    });

    expect(grant.outcome).toBe("created");
    expect(grant.entry.amountPoints).toBe(2_500);
    expect(grant.entry.createdBy?.role).toBe(Role.ADMIN);
    expect(summary.program?.currencyCode).toBe("USD");
    expect(summary.balancePoints).toBe(2_500);
    expect(history[0]?.currencyCode).toBe("USD");
    expect(adminList.items[0]?.balancePoints).toBe(2_500);
  });

  it("allows master admins to grant above the legacy stored manual-grant value", async () => {
    const admin = await createAdmin();
    const masterAdmin = await createMasterAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Master Admin Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 4_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 90,
      expirationReminderDays: 14,
      eligibleProductIds: [eligible.product.id],
    });

    const grant = await grantManualLoyaltyPointsByAdmin({
      actorUserId: masterAdmin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 50_000,
      reason: "Audited migration adjustment approved by the studio owner.",
      idempotencyKey: "loyalty:manual-grant:master-admin-high-value",
    });

    const auditLog = await prisma.auditLog.findFirst({
      where: {
        actionType: "LOYALTY_MANUAL_GRANT",
        entityId: grant.entry.id,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(grant.outcome).toBe("created");
    expect(grant.entry.amountPoints).toBe(50_000);
    expect(grant.entry.createdBy?.role).toBe(Role.MASTER_ADMIN);
    expect(grant.entry.reason).toBe("Audited migration adjustment approved by the studio owner.");
    expect(grant.entry.expiresAt).toEqual(new Date(grant.entry.happenedAt.getTime() + 90 * 24 * 60 * 60 * 1000));
    expect(auditLog?.metadata).toEqual(expect.objectContaining({
      actorRole: Role.MASTER_ADMIN,
      amountPoints: 50_000,
      reason: "Audited migration adjustment approved by the studio owner.",
    }));
  });

  it("enforces verified client ownership for client-facing loyalty reads", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const otherClient = await createVerifiedClient();
    const unverifiedClient = await createUnverifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Ownership Eligible Bottle",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 3_000,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });

    await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 80,
      reason: "Ownership-read coverage for verified client account.",
      idempotencyKey: "loyalty:manual-grant:ownership",
    });

    await expect(
      getClientLoyaltySummary({
        actor: { type: "CLIENT", userId: otherClient.id },
        clientId: client.id,
        currencyCode: "EUR",
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_REQUIRED" });

    await expect(
      listClientLoyaltyHistory({
        actor: { type: "CLIENT", userId: otherClient.id },
        clientId: client.id,
        currencyCode: "EUR",
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_REQUIRED" });

    await expect(
      getClientLoyaltySummary({
        actor: { type: "CLIENT", userId: unverifiedClient.id },
        clientId: unverifiedClient.id,
        currencyCode: "EUR",
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_CLIENT_EMAIL_UNVERIFIED" });
  });

  it("allows admin search to find verified zero-balance clients before a first manual grant", async () => {
    const admin = await createAdmin();
    const zeroBalanceClient = await createVerifiedClient();
    const activeLoyaltyClient = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Search Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2_500,
    });

    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });

    await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: activeLoyaltyClient.id,
      currencyCode: "EUR",
      amountPoints: 50,
      reason: "Keep one indexed loyalty client in the default view.",
      idempotencyKey: "loyalty:manual-grant:search-active",
    });

    const searchResults = await listAdminLoyaltyClientsByActor({
      actorUserId: admin.id,
      currencyCode: "EUR",
      query: zeroBalanceClient.email,
    });

    expect(searchResults.items).toEqual([
      expect.objectContaining({
        id: zeroBalanceClient.id,
        email: zeroBalanceClient.email,
        balancePoints: 0,
      }),
    ]);
  });

  it("redeems rewards into loyalty credit and supports reserve-capture-release flows", async () => {
    const admin = await createAdmin();
    const client = await createVerifiedClient();
    const eligible = await createCatalogProduct({
      namePrefix: "Reward Eligible Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });

    const program = await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });
    const reward = await saveLoyaltyRewardDefinitionByAdmin({
      actorUserId: admin.id,
      programId: program.id,
      name: "5 EURO Reward",
      pointsRequired: 500,
      amountMinor: 500,
    });

    await grantManualLoyaltyPointsByAdmin({
      actorUserId: admin.id,
      clientId: client.id,
      currencyCode: "EUR",
      amountPoints: 650,
      reason: "Seed loyalty balance for redemption coverage.",
      idempotencyKey: "loyalty:manual-grant:redemption-balance",
    });

    const rewards = await listActiveLoyaltyRewards({ currencyCode: "EUR" });
    expect(rewards).toEqual([
      expect.objectContaining({
        id: reward.id,
        pointsRequired: 500,
        amountMinor: 500,
      }),
    ]);

    const redemption = await redeemLoyaltyReward({
      actor: { type: "USER", userId: client.id, role: Role.CLIENT },
      clientId: client.id,
      currencyCode: "EUR",
      rewardDefinitionId: reward.id,
      idempotencyKey: "loyalty:reward:redeem:test",
      metadata: { source: "integration-test" },
    });

    expect(redemption.outcome).toBe("created");

    const balanceAfterRedeem = await getLoyaltyCreditBalance({
      clientId: client.id,
      currencyCode: "EUR",
    });
    expect(balanceAfterRedeem).toMatchObject({
      settledBalanceMinor: 500,
      reservedAmountMinor: 0,
      availableBalanceMinor: 500,
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 500,
        discountAmountMinor: 0,
        totalAmountMinor: 500,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
    });

    const releasedReservation = await reserveLoyaltyCreditValue({
      actor: { type: "USER", userId: client.id, role: Role.CLIENT },
      clientId: client.id,
      orderId: order.id,
      amountMinor: 200,
      currencyCode: "EUR",
      expiresAt: new Date("2026-06-24T10:00:00.000Z"),
      idempotencyKey: "loyalty:reserve:release-path",
      metadata: { source: "integration-test" },
    });
    await releaseLoyaltyCreditReservation({
      actor: { type: "SYSTEM", label: "integration-test" },
      reservationId: releasedReservation.reservation.id,
      idempotencyKey: "loyalty:release:release-path",
      metadata: { source: "integration-test" },
    });

    const capturedReservation = await reserveLoyaltyCreditValue({
      actor: { type: "USER", userId: client.id, role: Role.CLIENT },
      clientId: client.id,
      orderId: order.id,
      amountMinor: 300,
      currencyCode: "EUR",
      expiresAt: new Date("2026-06-24T11:00:00.000Z"),
      idempotencyKey: "loyalty:reserve:capture-path",
      metadata: { source: "integration-test" },
    });
    const internalPayment = await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.PENDING,
        amountMinor: 300,
        currencyCode: "EUR",
        method: PaymentMethod.LOYALTY_CREDIT,
        provider: PaymentProvider.INTERNAL,
      },
    });
    await captureLoyaltyCreditReservation({
      actor: { type: "SYSTEM", label: "integration-test" },
      reservationId: capturedReservation.reservation.id,
      paymentId: internalPayment.id,
      idempotencyKey: "loyalty:capture:capture-path",
      metadata: { source: "integration-test" },
    });

    const finalBalance = await getLoyaltyCreditBalance({
      clientId: client.id,
      currencyCode: "EUR",
    });
    expect(finalBalance).toMatchObject({
      settledBalanceMinor: 200,
      reservedAmountMinor: 0,
      availableBalanceMinor: 200,
    });
  });

  it("rejects reward update and archive when reward ids do not belong to the target program", async () => {
    const admin = await createAdmin();
    const eligible = await createCatalogProduct({
      namePrefix: "Scoped Reward Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2_000,
    });

    const programOne = await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [eligible.product.id],
    });
    const programTwo = await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: admin.id,
      currencyCode: "USD",
      isActive: false,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      eligibleProductIds: [],
    });
    const reward = await saveLoyaltyRewardDefinitionByAdmin({
      actorUserId: admin.id,
      programId: programOne.id,
      name: "Scoped Reward",
      pointsRequired: 200,
      amountMinor: 200,
    });

    await expect(
      saveLoyaltyRewardDefinitionByAdmin({
        actorUserId: admin.id,
        programId: programTwo.id,
        rewardDefinitionId: reward.id,
        name: "Cross Program Reward",
        pointsRequired: 250,
        amountMinor: 250,
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_REWARD_NOT_FOUND" });

    await expect(
      archiveLoyaltyRewardDefinitionByAdmin({
        actorUserId: admin.id,
        programId: programTwo.id,
        rewardDefinitionId: reward.id,
      }),
    ).rejects.toMatchObject({ code: "LOYALTY_REWARD_NOT_FOUND" });
  });

  it("demo loyalty seed is rerunnable without duplicate programs, eligible products, or rewards", async () => {
    await createCatalogProduct({
      namePrefix: "Demo Loyalty Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });
    await createCatalogProduct({
      namePrefix: "Demo Loyalty Pack",
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 9_500,
    });

    const first = await seedProductionLoyaltyProgram();
    const second = await seedProductionLoyaltyProgram();
    const [programCount, eligibleProductCount, rewardCount] = await Promise.all([
      prisma.loyaltyProgram.count({ where: { currencyCode: "EUR" } }),
      prisma.loyaltyEligibleProduct.count(),
      prisma.loyaltyRewardDefinition.count({ where: { name: "5 EURO Reward" } }),
    ]);
    const verification = await verifyDemoLoyaltyContract();

    expect(second.rewardDefinitionId).toBe(first.rewardDefinitionId);
    expect(programCount).toBe(1);
    expect(eligibleProductCount).toBe(2);
    expect(rewardCount).toBe(1);
    expect(verification).toEqual({
      programCount: 1,
      eligibleProductCount: 2,
      rewardCount: 1,
    });
  });

  it("demo loyalty verification fails when the active EUR program is absent", async () => {
    await expect(verifyDemoLoyaltyContract()).rejects.toThrow(
      /expected exactly one active EUR loyalty program/i,
    );
  });

  it("demo loyalty verification fails when the deterministic reward is absent", async () => {
    await createCatalogProduct({
      namePrefix: "Demo Missing Reward Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });
    await seedProductionLoyaltyProgram();
    await prisma.loyaltyRewardDefinition.deleteMany({ where: { name: "5 EURO Reward" } });

    await expect(verifyDemoLoyaltyContract()).rejects.toThrow(
      /expected one active 5 EURO Reward loyalty reward/i,
    );
  });

  it("demo loyalty verification fails when the deterministic reward value is invalid", async () => {
    await createCatalogProduct({
      namePrefix: "Demo Invalid Reward Mat",
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5_000,
    });
    await seedProductionLoyaltyProgram();
    await prisma.loyaltyRewardDefinition.updateMany({
      where: { name: "5 EURO Reward" },
      data: { pointsRequired: 450 },
    });

    await expect(verifyDemoLoyaltyContract()).rejects.toThrow(
      /5 EURO Reward loyalty reward is invalid/i,
    );
  });
});
