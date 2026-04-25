import "./helpers/setup-env";

import {
  BillingInterval,
  EntitlementScope,
  EntitlementType,
  MarketingSubscriptionStatus,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  SubscriptionStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  adjustAdminClientCredits,
  bulkAddClientMarketingSegments,
  bulkRemoveClientMarketingSegments,
  bulkSetClientMarketingSubscriptionStatus,
  createAdminUser,
  getAdminClientRecoveryState,
  updateAdminTeacherImage,
  updateAdminUser,
} from "../../src/lib/admin/admin-service";
import { excludeUnsubscribedRecipients } from "../../src/lib/marketing/marketing-audience";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin user management service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("prevents ADMIN from changing MASTER_ADMIN password", async () => {
    const adminPasswordHash = await hash("AdminPass123!", 12);
    const masterPasswordHash = await hash("MasterPass123!", 12);

    const [adminUser, masterAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.${Date.now()}@example.test`,
          role: Role.ADMIN,
          passwordHash: adminPasswordHash,
          emailVerified: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          name: "Master Admin",
          firstName: "Master",
          lastName: "Admin",
          email: `master.${Date.now()}@example.test`,
          role: Role.MASTER_ADMIN,
          passwordHash: masterPasswordHash,
          emailVerified: new Date(),
        },
      }),
    ]);

    await expect(
      updateAdminUser(
        masterAdmin.id,
        {
          firstName: "Master",
          lastName: "Admin",
          email: masterAdmin.email,
          role: Role.MASTER_ADMIN,
          isActive: true,
          password: "NewMasterPass456!",
        },
        {
          id: adminUser.id,
          role: Role.ADMIN,
        },
      ),
    ).rejects.toThrow("MASTER_ADMIN_MANAGEMENT_FORBIDDEN");
  });

  it("prevents ADMIN from creating MASTER_ADMIN", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin Creator",
        firstName: "Admin",
        lastName: "Creator",
        email: `admin.creator.${Date.now()}@example.test`,
        role: Role.ADMIN,
        passwordHash: await hash("AdminCreator123!", 12),
        emailVerified: new Date(),
      },
    });

    await expect(
      createAdminUser({
        name: "Escalation Target",
        email: `escalation.target.${Date.now()}@example.test`,
        role: Role.MASTER_ADMIN,
        isActive: true,
        password: "Escalation123!",
        createdByUserId: admin.id,
      }),
    ).rejects.toThrow("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN");
  });

  it("allows MASTER_ADMIN to create MASTER_ADMIN", async () => {
    const masterAdmin = await prisma.user.create({
      data: {
        name: "Master Creator",
        firstName: "Master",
        lastName: "Creator",
        email: `master.creator.${Date.now()}@example.test`,
        role: Role.MASTER_ADMIN,
        passwordHash: await hash("MasterCreator123!", 12),
        emailVerified: new Date(),
      },
    });

    const created = await createAdminUser({
      name: "Second Master",
      email: `master.created.${Date.now()}@example.test`,
      role: Role.MASTER_ADMIN,
      isActive: true,
      password: "SecondMaster123!",
      createdByUserId: masterAdmin.id,
    });

    expect(created.role).toBe(Role.MASTER_ADMIN);
    expect(created.createdByUserId).toBe(masterAdmin.id);
  });

  it("rejects non-admin actor at admin mutation boundary", async () => {
    const clientActor = await prisma.user.create({
      data: {
        name: "Client Actor",
        firstName: "Client",
        lastName: "Actor",
        email: `client.actor.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const targetUser = await prisma.user.create({
      data: {
        name: "Target User",
        firstName: "Target",
        lastName: "User",
        email: `target.user.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await expect(
      updateAdminUser(
        targetUser.id,
        {
          firstName: "Target",
          lastName: "Updated",
          email: targetUser.email,
          role: Role.CLIENT,
          isActive: true,
        },
        {
          id: clientActor.id,
          role: Role.CLIENT,
        },
      ),
    ).rejects.toThrow("ADMIN_USER_NOT_FOUND");
  });

  it("allows MASTER_ADMIN to update another MASTER_ADMIN password", async () => {
    const [masterActor, masterTarget] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Master Actor",
          firstName: "Master",
          lastName: "Actor",
          email: `master.actor.${Date.now()}@example.test`,
          role: Role.MASTER_ADMIN,
          passwordHash: await hash("MasterActor123!", 12),
          emailVerified: new Date(),
        },
      }),
      prisma.user.create({
        data: {
          name: "Master Target",
          firstName: "Master",
          lastName: "Target",
          email: `master.target.${Date.now()}@example.test`,
          role: Role.MASTER_ADMIN,
          passwordHash: await hash("MasterTarget123!", 12),
          emailVerified: new Date(),
        },
      }),
    ]);

    await updateAdminUser(
      masterTarget.id,
      {
        firstName: "Master",
        lastName: "Target",
        email: masterTarget.email,
        role: Role.MASTER_ADMIN,
        isActive: true,
        password: "MasterTarget456!",
      },
      {
        id: masterActor.id,
        role: Role.MASTER_ADMIN,
      },
    );

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: masterTarget.id },
      select: { passwordHash: true },
    });
    expect(updated.passwordHash).not.toBe(masterTarget.passwordHash);
  });

  it("fails safely when admin update target user does not exist", async () => {
    const admin = await prisma.user.create({
      data: {
        name: "Admin Missing Target",
        firstName: "Admin",
        lastName: "Missing",
        email: `admin.missing.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
    });

    await expect(
      updateAdminUser(
        "user_missing_target",
        {
          firstName: "Ghost",
          lastName: "User",
          email: `ghost.${Date.now()}@example.test`,
          role: Role.CLIENT,
          isActive: true,
        },
        {
          id: admin.id,
          role: Role.ADMIN,
        },
      ),
    ).rejects.toThrow("USER_NOT_FOUND");
  });

  it("adjusts credits through ledger entries and updates derived balance", async () => {
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.credits.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const product = await prisma.product.create({
      data: {
        name: "Credit Pack",
        slug: `credit-pack-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });

    await prisma.entitlementRule.create({
      data: {
        productId: product.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 10,
        isActive: true,
      },
    });

    await adjustAdminClientCredits({
      clientId: client.id,
      adminUserId: admin.id,
      productId: product.id,
      amount: 5,
      reason: "Seed starting credits",
    });

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        clientId: client.id,
        productId: product.id,
      },
      select: {
        id: true,
      },
    });

    expect(entitlement).not.toBeNull();

    await adjustAdminClientCredits({
      clientId: client.id,
      adminUserId: admin.id,
      entitlementId: entitlement!.id,
      amount: -2,
      reason: "Manual correction",
    });

    const aggregate = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: client.id,
      },
      _sum: {
        amount: true,
      },
    });

    expect(aggregate._sum.amount).toBe(3);

    const latestEntry = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: client.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        notes: true,
      },
    });

    expect(latestEntry?.notes).toBe("Manual correction");
  });

  it("rejects credit adjustment when reason is empty", async () => {
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.reason.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.reason.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const product = await prisma.product.create({
      data: {
        name: "Credit Pack",
        slug: `credit-pack-reason-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    await prisma.entitlementRule.create({
      data: {
        productId: product.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 10,
        isActive: true,
      },
    });

    await expect(
      adjustAdminClientCredits({
        clientId: client.id,
        adminUserId: admin.id,
        productId: product.id,
        amount: 2,
        reason: "   ",
      }),
    ).rejects.toThrow("CREDIT_ADJUSTMENT_REASON_REQUIRED");
  });

  it("rejects negative adjustment that would make entitlement balance negative", async () => {
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.negative.reject.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.negative.reject.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const product = await prisma.product.create({
      data: {
        name: "Credit Pack",
        slug: `credit-pack-negative-reject-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    await prisma.entitlementRule.create({
      data: {
        productId: product.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 10,
        isActive: true,
      },
    });

    await adjustAdminClientCredits({
      clientId: client.id,
      adminUserId: admin.id,
      productId: product.id,
      amount: 1,
      reason: "Seed one credit",
    });
    const entitlement = await prisma.clientEntitlement.findFirstOrThrow({
      where: {
        clientId: client.id,
        productId: product.id,
      },
      select: { id: true },
    });

    await expect(
      adjustAdminClientCredits({
        clientId: client.id,
        adminUserId: admin.id,
        entitlementId: entitlement.id,
        amount: -2,
        reason: "Overdraw attempt",
      }),
    ).rejects.toThrow("CREDIT_BALANCE_NEGATIVE_FORBIDDEN");
  });

  it("accepts valid negative adjustment and preserves ledger audit metadata", async () => {
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.negative.ok.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.negative.ok.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const product = await prisma.product.create({
      data: {
        name: "Credit Pack",
        slug: `credit-pack-negative-ok-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    await prisma.entitlementRule.create({
      data: {
        productId: product.id,
        entitlementType: EntitlementType.CREDIT_PACK,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        quantity: 10,
        isActive: true,
      },
    });

    await adjustAdminClientCredits({
      clientId: client.id,
      adminUserId: admin.id,
      productId: product.id,
      amount: 3,
      reason: "Seed credits",
    });
    const entitlement = await prisma.clientEntitlement.findFirstOrThrow({
      where: {
        clientId: client.id,
        productId: product.id,
      },
      select: { id: true },
    });

    await adjustAdminClientCredits({
      clientId: client.id,
      adminUserId: admin.id,
      entitlementId: entitlement.id,
      amount: -2,
      reason: "Correction down by 2",
    });

    const latestEntry = await prisma.creditLedgerEntry.findFirst({
      where: {
        clientId: client.id,
        entitlementId: entitlement.id,
        amount: -2,
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdById: true,
        notes: true,
        happenedAt: true,
      },
    });

    expect(latestEntry?.createdById).toBe(admin.id);
    expect(latestEntry?.notes).toBe("Correction down by 2");
    expect(latestEntry?.happenedAt).toBeTruthy();
  });

  it("stores teacher image path reference on upload flow", async () => {
    const [teacher, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Teacher User",
          firstName: "Teacher",
          lastName: "User",
          email: `teacher.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.teacher.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const result = await updateAdminTeacherImage({
      userId: teacher.id,
      imagePath: "/images/instructors/teacher-profile-1.jpg",
      adminUserId: admin.id,
    });

    expect(result.image).toBe("/images/instructors/teacher-profile-1.jpg");

    const persisted = await prisma.user.findUnique({
      where: { id: teacher.id },
      select: { image: true },
    });

    expect(persisted?.image).toBe("/images/instructors/teacher-profile-1.jpg");
  });

  it("bulk updates marketing subscription status for CLIENT users", async () => {
    const [admin, clientA, clientB] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.bulk.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client A",
          firstName: "Client",
          lastName: "A",
          email: `clienta.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client B",
          firstName: "Client",
          lastName: "B",
          email: `clientb.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await bulkSetClientMarketingSubscriptionStatus({
      actorUserId: admin.id,
      userIds: [clientA.id, clientB.id],
      status: MarketingSubscriptionStatus.SUBSCRIBED,
    });

    const rows = await prisma.user.findMany({
      where: { id: { in: [clientA.id, clientB.id] } },
      select: { id: true, marketingSubscriptionStatus: true },
      orderBy: { id: "asc" },
    });

    expect(rows).toEqual([
      { id: clientA.id, marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED },
      { id: clientB.id, marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED },
    ]);
  });

  it("bulk adds and removes segments for CLIENT users", async () => {
    const [admin, client, segmentA, segmentB] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.seg.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.seg.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.marketingSegment.create({
        data: {
          name: `VIP ${Date.now()}`,
          slug: `vip-${Date.now()}`,
          isActive: true,
        },
      }),
      prisma.marketingSegment.create({
        data: {
          name: `Trial ${Date.now()}`,
          slug: `trial-${Date.now()}`,
          isActive: true,
        },
      }),
    ]);

    await bulkAddClientMarketingSegments({
      actorUserId: admin.id,
      userIds: [client.id],
      segmentIds: [segmentA.id, segmentB.id],
    });

    let memberships = await prisma.marketingUserSegment.findMany({
      where: { userId: client.id },
      select: { segmentId: true },
      orderBy: { segmentId: "asc" },
    });

    expect(memberships.map((item) => item.segmentId).sort()).toEqual([segmentA.id, segmentB.id].sort());

    await bulkRemoveClientMarketingSegments({
      actorUserId: admin.id,
      userIds: [client.id],
      segmentIds: [segmentB.id],
    });

    memberships = await prisma.marketingUserSegment.findMany({
      where: { userId: client.id },
      select: { segmentId: true },
    });

    expect(memberships.map((item) => item.segmentId)).toEqual([segmentA.id]);
  });

  it("updates single CLIENT marketing settings via user update flow", async () => {
    const [admin, client, segment] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.single.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client User",
          firstName: "Client",
          lastName: "User",
          email: `client.single.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.marketingSegment.create({
        data: {
          name: `Wellness ${Date.now()}`,
          slug: `wellness-${Date.now()}`,
          isActive: true,
        },
      }),
    ]);

    await updateAdminUser(
      client.id,
      {
        firstName: "Client",
        lastName: "User",
        email: client.email,
        role: Role.CLIENT,
        isActive: true,
        marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
        marketingSegmentIds: [segment.id],
      },
      {
        id: admin.id,
        role: Role.ADMIN,
      },
    );

    const [updatedUser, memberships] = await Promise.all([
      prisma.user.findUnique({
        where: { id: client.id },
        select: { marketingSubscriptionStatus: true },
      }),
      prisma.marketingUserSegment.findMany({
        where: { userId: client.id },
        select: { segmentId: true },
      }),
    ]);

    expect(updatedUser?.marketingSubscriptionStatus).toBe(MarketingSubscriptionStatus.SUBSCRIBED);
    expect(memberships.map((item) => item.segmentId)).toEqual([segment.id]);
  });
  it("enforces CLIENT-only bulk marketing updates", async () => {
    const [admin, teacher] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Admin User",
          firstName: "Admin",
          lastName: "User",
          email: `admin.onlyclient.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Teacher User",
          firstName: "Teacher",
          lastName: "User",
          email: `teacher.onlyclient.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    await expect(
      bulkSetClientMarketingSubscriptionStatus({
        actorUserId: admin.id,
        userIds: [teacher.id],
        status: MarketingSubscriptionStatus.SUBSCRIBED,
      }),
    ).rejects.toThrow("MARKETING_CLIENT_ONLY");
  });

  it("keeps existing unsubscribe exclusion send safety", async () => {
    const [subscribedUser, unsubscribedUser] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Subscribed User",
          firstName: "Subscribed",
          lastName: "User",
          email: `subscribed.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Unsubscribed User",
          firstName: "Unsubscribed",
          lastName: "User",
          email: `unsubscribed.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await prisma.marketingUnsubscribe.create({
      data: {
        email: unsubscribedUser.email,
        userId: unsubscribedUser.id,
      },
    });

    const filtered = await excludeUnsubscribedRecipients([
      { userId: subscribedUser.id, email: subscribedUser.email },
      { userId: unsubscribedUser.id, email: unsubscribedUser.email },
    ]);

    expect(filtered).toEqual([{ userId: subscribedUser.id, email: subscribedUser.email.toLowerCase() }]);
  });

  describe("admin client recovery state", () => {
    async function makeAdminActor() {
      const admin = await prisma.user.create({
        data: {
          name: "Recovery Admin",
          email: `recovery.admin.${Date.now()}@example.test`,
          role: Role.ADMIN,
          emailVerified: new Date(),
        },
        select: { id: true, role: true },
      });
      return { actorId: admin.id, actorRole: admin.role };
    }

    async function makeClientWithSubscription(status: SubscriptionStatus) {
      const client = await prisma.user.create({
        data: {
          name: "Recovery Client",
          email: `recovery.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
        select: { id: true },
      });
      const product = await prisma.product.create({
        data: {
          name: "Recovery Membership",
          slug: `recovery-membership-${Date.now()}`,
          productType: ProductType.UNLIMITED_MEMBERSHIP,
          isActive: true,
          isArchived: false,
          sortOrder: 0,
        },
      });
      const price = await prisma.price.create({
        data: {
          productId: product.id,
          lookupKey: `recovery-price-${Date.now()}`,
          name: "Monthly",
          priceType: PriceType.RECURRING,
          currencyCode: "EUR",
          unitAmountMinor: 4900,
          billingInterval: BillingInterval.MONTH,
          billingIntervalCount: 1,
          isActive: true,
          isArchived: false,
        },
      });
      const contract = await prisma.subscriptionContract.create({
        data: {
          clientId: client.id,
          productId: product.id,
          priceId: price.id,
          status,
          startsAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          provider: PaymentProvider.STRIPE,
          providerSubscriptionReference: `sub_recovery_${Date.now()}`,
        },
      });
      return { client, product, contract };
    }

    it("returns HEALTHY for active subscription", async () => {
      const actor = await makeAdminActor();
      const { client } = await makeClientWithSubscription(SubscriptionStatus.ACTIVE);

      const state = await getAdminClientRecoveryState({ clientId: client.id, actor });
      expect(state.status).toBe("HEALTHY");
    });

    it("returns PAST_DUE for past_due subscription", async () => {
      const actor = await makeAdminActor();
      const { client } = await makeClientWithSubscription(SubscriptionStatus.PAST_DUE);

      const state = await getAdminClientRecoveryState({ clientId: client.id, actor });
      expect(state.status).toBe("PAST_DUE");
    });

    it("returns CANCELLED for cancelled subscription", async () => {
      const actor = await makeAdminActor();
      const { client } = await makeClientWithSubscription(SubscriptionStatus.CANCELLED);

      const state = await getAdminClientRecoveryState({ clientId: client.id, actor });
      expect(state.status).toBe("CANCELLED");
    });

    it("returns NONE for client with no subscriptions", async () => {
      const actor = await makeAdminActor();
      const client = await prisma.user.create({
        data: {
          name: "No Sub Client",
          email: `nosub.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      });

      const state = await getAdminClientRecoveryState({ clientId: client.id, actor });
      expect(state.status).toBe("NONE");
    });

    it("requires admin role", async () => {
      const client = await prisma.user.create({
        data: {
          name: "Non Admin",
          email: `nonadmin.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
        select: { id: true, role: true },
      });

      await expect(
        getAdminClientRecoveryState({
          clientId: client.id,
          actor: { actorId: client.id, actorRole: client.role },
        }),
      ).rejects.toThrow("ADMIN_ROLE_REQUIRED");
    });
  });
});
