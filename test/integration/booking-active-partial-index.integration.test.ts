import "./helpers/setup-env";

import { BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

let fixtureSequence = 0;

async function createBookingIndexFixture() {
  fixtureSequence += 1;
  const unique = `${Date.now()}-${fixtureSequence}`;

  const category = await createClassCategory(prisma, {
    name: "Schema Migration",
    slug: `schema-migration-${unique}`,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Partial Index Flow",
    slug: `partial-index-flow-${unique}`,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Partial Index Teacher",
      email: `partial-index-teacher-${unique}@example.test`,
      role: Role.TEACHER,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Partial Index Client",
      email: `partial-index-client-${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Partial Index Template",
      slug: `partial-index-template-${unique}`,
      defaultCapacity: 6,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Partial Index Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 6,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  return { client, session };
}

async function createBooking(input: Awaited<ReturnType<typeof createBookingIndexFixture>> & { status: BookingStatus }) {
  return prisma.booking.create({
    data: {
      clientId: input.client.id,
      studioSessionId: input.session.id,
      status: input.status,
      bookingIntent: "SINGLE_BOOKING",
      customerName: input.client.name,
      customerEmail: input.client.email,
      customerPhone: "+32000000000",
    },
  });
}

async function expectDuplicateActiveBookingRejected(
  fixture: Awaited<ReturnType<typeof createBookingIndexFixture>>,
  firstStatus: BookingStatus.PENDING | BookingStatus.CONFIRMED,
  secondStatus: BookingStatus.PENDING | BookingStatus.CONFIRMED,
) {
  await createBooking({ ...fixture, status: firstStatus });

  await expect(createBooking({ ...fixture, status: secondStatus })).rejects.toMatchObject({
    code: "P2002",
  });
}

describe("Booking active partial unique index", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("exists as the migration-owned partial index", async () => {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'Booking'
        AND indexname = 'Booking_active_client_session_unique'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indexdef).toContain("UNIQUE INDEX");
    expect(rows[0]?.indexdef).toContain("\"clientId\"");
    expect(rows[0]?.indexdef).toContain("\"studioSessionId\"");
    expect(rows[0]?.indexdef).toContain("'PENDING'::\"BookingStatus\"");
    expect(rows[0]?.indexdef).toContain("'CONFIRMED'::\"BookingStatus\"");
  });

  it("blocks duplicate active client/session bookings", async () => {
    await expectDuplicateActiveBookingRejected(
      await createBookingIndexFixture(),
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
    );
    await expectDuplicateActiveBookingRejected(
      await createBookingIndexFixture(),
      BookingStatus.CONFIRMED,
      BookingStatus.PENDING,
    );
    await expectDuplicateActiveBookingRejected(
      await createBookingIndexFixture(),
      BookingStatus.PENDING,
      BookingStatus.PENDING,
    );
  });

  it("allows historical rows before a new pending booking", async () => {
    const fixture = await createBookingIndexFixture();

    await createBooking({ ...fixture, status: BookingStatus.CANCELLED });
    await createBooking({ ...fixture, status: BookingStatus.EXPIRED });
    await createBooking({ ...fixture, status: BookingStatus.COMPLETED });
    await createBooking({ ...fixture, status: BookingStatus.NO_SHOW });
    const active = await createBooking({ ...fixture, status: BookingStatus.PENDING });

    const bookings = await prisma.booking.findMany({
      where: {
        clientId: fixture.client.id,
        studioSessionId: fixture.session.id,
      },
      orderBy: { createdAt: "asc" },
      select: { status: true },
    });

    expect(active.status).toBe(BookingStatus.PENDING);
    expect(bookings.map((booking) => booking.status)).toEqual([
      BookingStatus.CANCELLED,
      BookingStatus.EXPIRED,
      BookingStatus.COMPLETED,
      BookingStatus.NO_SHOW,
      BookingStatus.PENDING,
    ]);
  });
});
