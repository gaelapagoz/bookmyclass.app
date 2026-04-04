import "./helpers/setup-env";

import { EntitlementScope, EntitlementType, MarketingSubscriptionStatus, ProductType, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  adjustAdminClientCredits,
  bulkAddClientMarketingSegments,
  bulkRemoveClientMarketingSegments,
  bulkSetClientMarketingSubscriptionStatus,
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
});

