import "./helpers/setup-env";

import {
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  addTeacherSessionAttendee,
  getTeacherAssignedSessions,
  getTeacherSelfProfile,
  getTeacherSessionRosterData,
  removeTeacherSessionAttendee,
  updateTeacherSelfImage,
  updateTeacherSelfProfile,
} from "../../src/lib/teacher/teacher-service";

async function seedTeacherSessionFixture() {
  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `teacher-collective-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Teacher Pilates",
    slug: `teacher-pilates-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const [teacherA, teacherB, client] = await Promise.all([
    prisma.user.create({
      data: {
        name: "Teacher A",
        email: `teacher.a.${Date.now()}@example.test`,
        role: Role.TEACHER,
        teacherProfile: { create: {} },
      },
    }),
    prisma.user.create({
      data: {
        name: "Teacher B",
        email: `teacher.b.${Date.now()}@example.test`,
        role: Role.TEACHER,
        teacherProfile: { create: {} },
      },
    }),
    prisma.user.create({
      data: {
        name: "Client One",
        email: `teacher.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    }),
  ]);

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacherA.id,
      title: "Teacher Fixture Template",
      slug: `teacher-template-${Date.now()}`,
      defaultCapacity: 10,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const [sessionA, sessionB] = await Promise.all([
    prisma.studioSession.create({
      data: {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: teacherA.id,
        title: "Teacher A Session",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacity: 10,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    }),
    prisma.studioSession.create({
      data: {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: teacherB.id,
        title: "Teacher B Session",
        startsAt: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
        endsAt: new Date(startsAt.getTime() + 25 * 60 * 60 * 1000),
        capacity: 10,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    }),
  ]);

  const product = await prisma.product.create({
    data: {
      name: `Teacher Pack ${Date.now()}`,
      slug: `teacher-pack-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: client.id,
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId: client.id,
      entitlementId: entitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 2,
      notes: "Teacher integration seed grant",
    },
  });

  return { teacherA, teacherB, client, sessionA, sessionB, entitlement };
}

async function grantTeacherCollectiveUnlimitedSubscription(input: { clientId: string }) {
  const now = new Date();
  const product = await prisma.product.create({
    data: {
      name: `Teacher Unlimited ${Date.now()}`,
      slug: `teacher-unlimited-${Date.now()}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 10,
      entitlementRules: {
        create: {
          entitlementType: EntitlementType.UNLIMITED_ACCESS,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          isActive: true,
        },
      },
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `teacher-unlimited-price-${Date.now()}`,
      name: "Teacher Unlimited Monthly",
      priceType: "RECURRING",
      currencyCode: "EUR",
      unitAmountMinor: 10900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.subscriptionContract.create({
    data: {
      clientId: input.clientId,
      productId: product.id,
      priceId: price.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false,
      provider: "STRIPE",
      providerSubscriptionReference: `teacher_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    },
  });
}

describe("teacher service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only assigned sessions for teacher", async () => {
    const { teacherA, sessionA } = await seedTeacherSessionFixture();
    const sessions = await getTeacherAssignedSessions({ teacherUserId: teacherA.id });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(sessionA.id);
    expect(sessions[0]?.waitlistCount).toBe(0);
  });

  it("allows reading own profile and updating only own teacher profile", async () => {
    const { teacherA } = await seedTeacherSessionFixture();
    const profileBefore = await getTeacherSelfProfile(teacherA.id);

    expect(profileBefore?.id).toBe(teacherA.id);

    await updateTeacherSelfProfile({
      teacherUserId: teacherA.id,
      requestedTeacherUserId: teacherA.id,
      firstName: "Updated",
      lastName: "Teacher",
      phone: "+32000000010",
      bio: "Updated bio",
      specialties: ["Pilates"],
      certifications: ["L1"],
    });

    const profileAfter = await getTeacherSelfProfile(teacherA.id);
    expect(profileAfter?.firstName).toBe("Updated");
    expect(profileAfter?.lastName).toBe("Teacher");
    expect(profileAfter?.phone).toBe("+32000000010");

    await expect(
      updateTeacherSelfProfile({
        teacherUserId: teacherA.id,
        requestedTeacherUserId: "different-teacher-id",
        firstName: "Blocked",
        lastName: "Update",
      }),
    ).rejects.toThrow("TEACHER_SELF_SCOPE_FORBIDDEN");
  });

  it("allows teacher own image update and blocks cross-teacher image edit", async () => {
    const { teacherA, teacherB } = await seedTeacherSessionFixture();

    const updated = await updateTeacherSelfImage({
      teacherUserId: teacherA.id,
      requestedTeacherUserId: teacherA.id,
      imagePath: "/uploads/teachers/teacher-own.png",
    });

    expect(updated.image).toBe("/uploads/teachers/teacher-own.png");

    await expect(
      updateTeacherSelfImage({
        teacherUserId: teacherA.id,
        requestedTeacherUserId: teacherB.id,
        imagePath: "/uploads/teachers/teacher-cross.png",
      }),
    ).rejects.toThrow("TEACHER_SELF_SCOPE_FORBIDDEN");
  });

  it("accepts canonical teacher image updates and persists normalized path", async () => {
    const { teacherA } = await seedTeacherSessionFixture();

    const updated = await updateTeacherSelfImage({
      teacherUserId: teacherA.id,
      requestedTeacherUserId: teacherA.id,
      imagePath: "/uploads/teachers/teacher-own-canonical.png",
    });

    expect(updated.image).toBe("/uploads/teachers/teacher-own-canonical.png");

    const persisted = await prisma.user.findUnique({
      where: { id: teacherA.id },
      select: { image: true },
    });

    expect(persisted?.image).toBe("/uploads/teachers/teacher-own-canonical.png");
  });

  it("returns fallback image when canonical teacher image file is missing", async () => {
    const { teacherA } = await seedTeacherSessionFixture();

    await prisma.user.update({
      where: { id: teacherA.id },
      data: { image: "/uploads/teachers/missing-teacher-image.jpg" },
    });

    const profile = await getTeacherSelfProfile(teacherA.id);
    expect(profile?.image).toBe("");
  });

  it("resolves canonical teacher image paths with surrounding whitespace", async () => {
    const { teacherA } = await seedTeacherSessionFixture();

    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-teacher-profile-"));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PUBLIC_UPLOADS_BASE_PATH = "/uploads";
    await mkdir(path.join(uploadsDir, "teachers"), { recursive: true });
    await writeFile(path.join(uploadsDir, "teachers", "whitespace-canonical.jpg"), Buffer.from([0xff, 0xd8, 0xff]));

    await prisma.user.update({
      where: { id: teacherA.id },
      data: { image: "   /uploads/teachers/whitespace-canonical.jpg   " },
    });

    const profile = await getTeacherSelfProfile(teacherA.id);
    expect(profile?.image).toBe("/uploads/teachers/whitespace-canonical.jpg");
  });

  it("restricts roster reads and mutations to assigned sessions and reuses eligibility rules", async () => {
    const { teacherA, teacherB, client, sessionA, sessionB, entitlement } = await seedTeacherSessionFixture();

    const roster = await getTeacherSessionRosterData({
      teacherUserId: teacherA.id,
      sessionId: sessionA.id,
    });
    expect(roster?.session.id).toBe(sessionA.id);

    await expect(
      getTeacherSessionRosterData({
        teacherUserId: teacherA.id,
        sessionId: sessionB.id,
      }),
    ).rejects.toThrow("TEACHER_SESSION_FORBIDDEN");

    const added = await addTeacherSessionAttendee({
      teacherUserId: teacherA.id,
      studioSessionId: sessionA.id,
      clientId: client.id,
    });
    expect(added.usedCreditEntitlementId).toBe(entitlement.id);

    const consume = await prisma.creditLedgerEntry.findFirst({
      where: {
        bookingId: added.bookingId,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.CONSUME,
      },
      select: { amount: true },
    });
    expect(consume?.amount).toBe(-1);

    await expect(
      addTeacherSessionAttendee({
        teacherUserId: teacherA.id,
        studioSessionId: sessionB.id,
        clientId: client.id,
      }),
    ).rejects.toThrow("TEACHER_SESSION_FORBIDDEN");

    await expect(
      removeTeacherSessionAttendee({
        teacherUserId: teacherB.id,
        studioSessionId: sessionA.id,
        bookingId: added.bookingId,
      }),
    ).rejects.toThrow("TEACHER_SESSION_FORBIDDEN");
  });

  it("requires eligible access for teacher add and allows qualifying subscription access", async () => {
    const { teacherA, client, sessionA } = await seedTeacherSessionFixture();

    await prisma.creditLedgerEntry.deleteMany({
      where: {
        clientId: client.id,
      },
    });

    await expect(
      addTeacherSessionAttendee({
        teacherUserId: teacherA.id,
        studioSessionId: sessionA.id,
        clientId: client.id,
      }),
    ).rejects.toThrow("SESSION_ELIGIBILITY_REQUIRED");

    await grantTeacherCollectiveUnlimitedSubscription({ clientId: client.id });

    const added = await addTeacherSessionAttendee({
      teacherUserId: teacherA.id,
      studioSessionId: sessionA.id,
      clientId: client.id,
    });

    expect(added.status).toBe("CONFIRMED");
    expect(added.usedCreditEntitlementId).toBeNull();
  });
});
