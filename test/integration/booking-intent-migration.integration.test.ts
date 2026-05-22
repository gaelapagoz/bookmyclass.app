import "./helpers/setup-env";
import { BookingIntent, BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

describe("BookingIntent migration contract", () => {
  it("applies expand/migrate/contract migrations and leaves no USE_PLAN residuals", async () => {
    await resetDb();

    const appliedMigrations = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE migration_name IN (
        '20260522110000_booking_intent_expand',
        '20260522111000_booking_intent_migrate',
        '20260522112000_booking_intent_contract'
      )
      ORDER BY migration_name ASC
    `;

    expect(appliedMigrations.map((row) => row.migration_name)).toEqual([
      "20260522110000_booking_intent_expand",
      "20260522111000_booking_intent_migrate",
      "20260522112000_booking_intent_contract",
    ]);

    const enumLabels = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'BookingIntent'
      ORDER BY e.enumsortorder ASC
    `;

    expect(enumLabels.map((row) => row.enumlabel)).toEqual([
      "SINGLE_BOOKING",
      "USE_ENTITLEMENT",
    ]);

    const category = await createClassCategory(prisma, {
      name: "Migration Yoga",
      slug: `migration-yoga-${Date.now()}`,
      sortOrder: 1,
      isActive: true,
    });

    const classType = await createClassType(prisma, {
      categoryId: category.id,
      name: "Migration Vinyasa",
      slug: `migration-vinyasa-${Date.now()}`,
      sortOrder: 1,
      isActive: true,
      isVisible: true,
    });

    const teacher = await prisma.user.create({
      data: {
        name: "Migration Teacher",
        email: `migration.teacher.${Date.now()}@example.test`,
        role: Role.TEACHER,
      },
    });

    const template = await prisma.classTemplate.create({
      data: {
        classTypeId: classType.id,
        defaultTeacherId: teacher.id,
        title: "Migration Template",
        slug: `migration-template-${Date.now()}`,
        defaultCapacity: 10,
        defaultDurationMinutes: 60,
        isActive: true,
        isPublished: true,
      },
    });

    const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const session = await prisma.studioSession.create({
      data: {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: teacher.id,
        title: "Migration Session",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacity: 10,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    });

    const client = await prisma.user.create({
      data: {
        name: "Migration Client",
        email: `migration.client.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await prisma.booking.create({
      data: {
        studioSessionId: session.id,
        clientId: client.id,
        status: BookingStatus.PENDING,
        bookingIntent: BookingIntent.USE_ENTITLEMENT,
        customerName: client.name,
        customerEmail: client.email,
        customerPhone: "+32000000111",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(),
      },
    });

    const legacyResidualRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Booking"
      WHERE "bookingIntent"::text = 'USE_PLAN'
    `;

    expect(Number(legacyResidualRows[0]?.count ?? 0n)).toBe(0);
  }, 30000);
});
