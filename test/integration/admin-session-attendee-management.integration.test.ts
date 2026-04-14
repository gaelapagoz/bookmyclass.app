import "./helpers/setup-env";

import {
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  Role,
  StudioSessionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  addSessionAttendeeByManager,
  getAdminSessionById,
  getAdminSessionOptions,
  removeSessionAttendeeByManager,
} from "../../src/lib/admin/admin-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture() {
  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `collective-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Pilates",
    slug: `pilates-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.session.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Pilates Session",
      slug: `pilates-template-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Pilates Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  return {
    session,
    teacher,
  };
}

async function grantCollectiveCredits(input: { clientId: string; amount: number }) {
  const product = await prisma.product.create({
    data: {
      name: `Pack ${Date.now()}`,
      slug: `pack-${Date.now()}`,
      productType: "CLASS_PACK",
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: input.clientId,
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
      clientId: input.clientId,
      entitlementId: entitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: input.amount,
      notes: "Seed grant",
    },
  });

  return entitlement;
}

describe("admin session attendee management service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("loads session attendees in admin session detail", async () => {
    const { session } = await createSessionFixture();
    const client = await prisma.user.create({
      data: {
        name: "Client One",
        email: `client.one.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: client.name,
        customerEmail: client.email,
      },
    });

    const detail = await getAdminSessionById(session.id);

    expect(detail).not.toBeNull();
    expect(detail?.attendees).toHaveLength(1);
    expect(detail?.attendees[0]?.clientName).toBe("Client One");
  });

  it("removing attendee restores consumed credit through ledger", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Two",
          email: `client.two.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin",
          email: `admin.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const entitlement = await grantCollectiveCredits({ clientId: client.id, amount: 5 });

    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        selectedEntitlementId: entitlement.id,
        customerName: client.name,
        customerEmail: client.email,
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: booking.id,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        notes: "Seed consume",
      },
    });

    await removeSessionAttendeeByManager({
      studioSessionId: session.id,
      bookingId: booking.id,
      note: "Client requested",
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const updatedBooking = await prisma.booking.findUnique({
      where: { id: booking.id },
      select: { status: true, creditRefundedAt: true },
    });

    const restore = await prisma.creditLedgerEntry.findFirst({
      where: {
        bookingId: booking.id,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.RESTORE,
      },
      select: { amount: true },
    });

    expect(updatedBooking?.status).toBe(BookingStatus.CANCELLED);
    expect(updatedBooking?.creditRefundedAt).not.toBeNull();
    expect(restore?.amount).toBe(1);
  });

  it("adding attendee with available credit consumes one credit", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Three",
          email: `client.three.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Two",
          email: `admin.two.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const entitlement = await grantCollectiveCredits({ clientId: client.id, amount: 2 });

    const result = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    expect(result.usedCreditEntitlementId).toBe(entitlement.id);
    expect(result.overrideApplied).toBe(false);

    const consume = await prisma.creditLedgerEntry.findFirst({
      where: {
        bookingId: result.bookingId,
        entitlementId: entitlement.id,
        entryType: CreditLedgerEntryType.CONSUME,
      },
      select: { amount: true },
    });

    expect(consume?.amount).toBe(-1);
  });

  it("ADMIN and MASTER_ADMIN can add without credits only with note", async () => {
    const { session } = await createSessionFixture();
    const [clientOne, clientTwo, admin, masterAdmin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Four",
          email: `client.four.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Five",
          email: `client.five.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Three",
          email: `admin.three.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
      prisma.user.create({
        data: {
          name: "Master Admin",
          email: `master.admin.${Date.now()}@example.test`,
          role: Role.MASTER_ADMIN,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: clientOne.id,
        actor: {
          userId: admin.id,
          role: Role.ADMIN,
        },
      }),
    ).rejects.toThrow("SESSION_OVERRIDE_NOTE_REQUIRED");

    const adminResult = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: clientOne.id,
      note: "Guest pass",
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const masterResult = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: clientTwo.id,
      note: "Manual override",
      actor: {
        userId: masterAdmin.id,
        role: Role.MASTER_ADMIN,
      },
    });

    expect(adminResult.overrideApplied).toBe(true);
    expect(masterResult.overrideApplied).toBe(true);
  });

  it("TEACHER cannot add attendee without available credits", async () => {
    const { session, teacher } = await createSessionFixture();
    const [client] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Six",
          email: `client.six.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: client.id,
        note: "Trying override",
        actor: {
          userId: teacher.id,
          role: Role.TEACHER,
        },
      }),
    ).rejects.toThrow("TEACHER_CREDIT_OVERRIDE_FORBIDDEN");
  });

  it("TEACHER cannot add attendee on unassigned session", async () => {
    const { session } = await createSessionFixture();
    const [client, unassignedTeacher] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Unassigned",
          email: `client.unassigned.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Teacher Unassigned",
          email: `teacher.unassigned.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    await expect(
      addSessionAttendeeByManager({
        studioSessionId: session.id,
        clientId: client.id,
        actor: {
          userId: unassignedTeacher.id,
          role: Role.TEACHER,
        },
      }),
    ).rejects.toThrow("TEACHER_SESSION_FORBIDDEN");
  });

  it("shows attendee after add and removes from detail list after removal", async () => {
    const { session } = await createSessionFixture();
    const [client, admin] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Seven",
          email: `client.seven.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Four",
          email: `admin.four.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    await grantCollectiveCredits({ clientId: client.id, amount: 1 });

    const addResult = await addSessionAttendeeByManager({
      studioSessionId: session.id,
      clientId: client.id,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const withAttendee = await getAdminSessionById(session.id);
    expect(withAttendee?.attendees.some((attendee) => attendee.bookingId === addResult.bookingId)).toBe(true);

    await removeSessionAttendeeByManager({
      studioSessionId: session.id,
      bookingId: addResult.bookingId,
      actor: {
        userId: admin.id,
        role: Role.ADMIN,
      },
    });

    const afterRemoval = await getAdminSessionById(session.id);
    expect(afterRemoval?.attendees.some((attendee) => attendee.bookingId === addResult.bookingId)).toBe(false);
  });

  it("returns selectable clients with credit visibility for the session scope", async () => {
    const { session } = await createSessionFixture();
    const [clientWithCredits, clientWithoutCredits] = await Promise.all([
      prisma.user.create({
        data: {
          name: "Client Eight",
          email: `client.eight.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
      prisma.user.create({
        data: {
          name: "Client Nine",
          email: `client.nine.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      }),
    ]);

    await grantCollectiveCredits({ clientId: clientWithCredits.id, amount: 2 });

    const options = await getAdminSessionOptions(session.id);
    const withCredits = options.clients.find((client) => client.id === clientWithCredits.id);
    const withoutCredits = options.clients.find((client) => client.id === clientWithoutCredits.id);

    expect(withCredits?.hasAvailableCredits).toBe(true);
    expect(withCredits?.availableCredits).toBe(2);
    expect(withoutCredits?.hasAvailableCredits).toBe(false);
    expect(withoutCredits?.availableCredits).toBe(0);
  });
});
