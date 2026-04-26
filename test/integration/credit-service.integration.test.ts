import "./helpers/setup-env";

import { CreditLedgerEntryType, EntitlementScope, EntitlementType, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { consumeCredit, InsufficientCreditsError } from "../../src/lib/credits/credit-service";
import { prisma } from "../../src/lib/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionId(): Promise<string> {
  const unique = Date.now().toString() + Math.random().toString(36).slice(2);

  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-credit-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Flow",
    slug: `flow-credit-${unique}`,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: `Teacher Credit ${unique}`,
      email: `teacher.credit.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Flow Template",
      slug: `flow-template-credit-${unique}`,
      defaultCapacity: 5,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Flow Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 5,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });
  return session.id;
}

async function createClientWithOneCredit() {
  const unique = Date.now().toString() + Math.random().toString(36).slice(2);

  const client = await prisma.user.create({
    data: {
      name: `Credit Client ${unique}`,
      email: `credit.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: `Drop-in ${unique}`,
      slug: `drop-in-${unique}`,
      productType: "DROP_IN_CLASS",
      isActive: true,
      isArchived: false,
      sortOrder: 0,
    },
  });

  const entitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: client.id,
      productId: product.id,
      entitlementType: EntitlementType.SINGLE_USE,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: "ACTIVE",
    },
  });

  // Grant exactly 1 credit
  await prisma.creditLedgerEntry.create({
    data: {
      clientId: client.id,
      entitlementId: entitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 1,
    },
  });

  // Create a booking stub to hang the CONSUME on
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      studioSessionId: await createSessionId(),
      status: "CONFIRMED",
      bookingIntent: "SINGLE_BOOKING",
      customerName: client.name,
      customerEmail: `credit.${unique}@example.test`,
      customerPhone: "+10000000000",
    },
  });

  return { client, entitlement, booking };
}

describe("consumeCredit", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("consumes 1 credit from an entitlement with balance 1", async () => {
    const { client, entitlement, booking } = await createClientWithOneCredit();

    const result = await consumeCredit({
      clientId: client.id,
      entitlementId: entitlement.id,
      bookingId: booking.id,
      reason: "test:consume",
      idempotencyKey: `test:${client.id}:${entitlement.id}:${booking.id}`,
    });

    expect(result.consumed).toBe(true);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entitlementId: entitlement.id },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(0);
  });

  it("throws InsufficientCreditsError when balance is 0", async () => {
    const { client, entitlement, booking } = await createClientWithOneCredit();

    // Consume the only credit first
    await consumeCredit({
      clientId: client.id,
      entitlementId: entitlement.id,
      bookingId: booking.id,
      reason: "test:first",
      idempotencyKey: `test:first:${client.id}:${entitlement.id}`,
    });

    // Create a second booking stub on a different session (unique constraint on clientId+sessionId)
    const booking2 = await prisma.booking.create({
      data: {
        clientId: client.id,
        studioSessionId: await createSessionId(),
        status: "CONFIRMED",
        bookingIntent: "SINGLE_BOOKING",
        customerName: client.name,
        customerEmail: `second.${client.id}@example.test`,
        customerPhone: "+10000000000",
      },
    });

    await expect(
      consumeCredit({
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: booking2.id,
        reason: "test:second",
        idempotencyKey: `test:second:${client.id}:${entitlement.id}`,
      }),
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it("is idempotent: second call with same key returns consumed=false without double-deducting", async () => {
    const { client, entitlement, booking } = await createClientWithOneCredit();
    const key = `test:idempotent:${client.id}:${entitlement.id}`;

    const first = await consumeCredit({
      clientId: client.id,
      entitlementId: entitlement.id,
      bookingId: booking.id,
      reason: "test:idempotent",
      idempotencyKey: key,
    });

    const second = await consumeCredit({
      clientId: client.id,
      entitlementId: entitlement.id,
      bookingId: booking.id,
      reason: "test:idempotent",
      idempotencyKey: key,
    });

    expect(first.consumed).toBe(true);
    expect(second.consumed).toBe(false);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entitlementId: entitlement.id },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(0);
  });

  it("allows at most one concurrent deduction when balance is 1", async () => {
    const { client, entitlement } = await createClientWithOneCredit();

    // Each booking needs its own session due to unique constraint on (clientId, studioSessionId)
    const [sessionA, sessionB] = await Promise.all([createSessionId(), createSessionId()]);

    const [bookingA, bookingB] = await Promise.all([
      prisma.booking.create({
        data: {
          clientId: client.id,
          studioSessionId: sessionA,
          status: "CONFIRMED",
          bookingIntent: "SINGLE_BOOKING",
          customerName: client.name,
          customerEmail: `a.${client.id}@example.test`,
          customerPhone: "+10000000000",
        },
      }),
      prisma.booking.create({
        data: {
          clientId: client.id,
          studioSessionId: sessionB,
          status: "CONFIRMED",
          bookingIntent: "SINGLE_BOOKING",
          customerName: client.name,
          customerEmail: `b.${client.id}@example.test`,
          customerPhone: "+10000000000",
        },
      }),
    ]);

    const results = await Promise.allSettled([
      consumeCredit({
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: bookingA.id,
        reason: "test:concurrent-a",
        idempotencyKey: `concurrent-a:${client.id}:${entitlement.id}`,
      }),
      consumeCredit({
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: bookingB.id,
        reason: "test:concurrent-b",
        idempotencyKey: `concurrent-b:${client.id}:${entitlement.id}`,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled" && r.value.consumed);
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must succeed; the other must fail. The loser may throw InsufficientCreditsError
    // (read-after-commit path) or a Prisma/Postgres transaction error (serialization abort path).
    // We assert the invariant — balance stays at 0 — not the specific error type.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: client.id, entitlementId: entitlement.id },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(0);
  });

  it("rejects consumption when reason is empty", async () => {
    const { client, entitlement, booking } = await createClientWithOneCredit();

    await expect(
      consumeCredit({
        clientId: client.id,
        entitlementId: entitlement.id,
        bookingId: booking.id,
        reason: "  ",
        idempotencyKey: `test:empty-reason:${client.id}`,
      }),
    ).rejects.toThrow("CREDIT_CONSUME_REASON_REQUIRED");
  });
});
