import "./helpers/setup-env";

import { EntitlementScope, EntitlementType, ProductType, Role } from "@prisma/client";
import { hash } from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  adjustAdminClientCredits,
  updateAdminTeacherImage,
  updateAdminUser,
} from "../../src/lib/admin/admin-service";
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
});
