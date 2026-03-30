import "./helpers/setup-env";
import { BookingStatus, Role, ServicePricingMode, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { getAdminDashboardInsights } from "../../src/lib/admin/admin-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function createTeacher(name: string, email: string) {
  return prisma.user.create({
    data: {
      name,
      email,
      role: Role.TEACHER,
      isActive: true,
      isInactive: false,
    },
  });
}

async function createClient(name: string, email: string) {
  return prisma.user.create({
    data: {
      name,
      email,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
    },
  });
}

async function createTemplateAndSessions(input: {
  className: string;
  classSlug: string;
  templateSlug: string;
  teacherId: string;
  capacity: number;
  sessionDaysAgo: number[];
}) {
  const category = await createClassCategory(prisma, {
    name: `Category ${input.className}`,
    slug: `category-${input.classSlug}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: input.className,
    slug: input.classSlug,
    defaultDurationMinutes: 60,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: input.teacherId,
      title: input.className,
      slug: input.templateSlug,
      defaultCapacity: input.capacity,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const sessions = [];
  for (const dayOffset of input.sessionDaysAgo) {
    const startsAt = daysAgo(dayOffset);
    startsAt.setHours(18, 0, 0, 0);
    sessions.push(
      await prisma.studioSession.create({
        data: {
          classTemplateId: template.id,
          classTypeId: classType.id,
          teacherId: input.teacherId,
          title: input.className,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          capacity: input.capacity,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
      }),
    );
  }

  return { classType, template, sessions };
}

describe("admin dashboard insights integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns insights with limits, correct exclusions, and staff occupancy math", async () => {
    const orsi = await createTeacher("Orsi", `orsi.${Date.now()}@example.test`);
    const giulia = await createTeacher("Giulia Vago", `giulia.${Date.now()}@example.test`);
    const elisa = await createTeacher("Elisa", `elisa.${Date.now()}@example.test`);
    const ourania = await createTeacher("Ourania", `ourania.${Date.now()}@example.test`);
    const occupancyCoach = await createTeacher(
      "Occupancy Coach",
      `occupancy.${Date.now()}@example.test`,
    );

    const [pilates, rocket, vinyasa, trx, stretch, bonus] = await Promise.all([
      createTemplateAndSessions({
        className: "Pilates with Props",
        classSlug: `pilates-with-props-${Date.now()}`,
        templateSlug: `template-pilates-${Date.now()}`,
        teacherId: orsi.id,
        capacity: 12,
        sessionDaysAgo: [3, 7, 10, 14],
      }),
      createTemplateAndSessions({
        className: "Rocket Yoga",
        classSlug: `rocket-yoga-${Date.now()}-a`,
        templateSlug: `template-rocket-${Date.now()}`,
        teacherId: giulia.id,
        capacity: 10,
        sessionDaysAgo: [4, 8, 12, 16],
      }),
      createTemplateAndSessions({
        className: "Vinyasa Yoga",
        classSlug: `vinyasa-yoga-${Date.now()}-a`,
        templateSlug: `template-vinyasa-${Date.now()}`,
        teacherId: elisa.id,
        capacity: 10,
        sessionDaysAgo: [5, 11, 17, 21],
      }),
      createTemplateAndSessions({
        className: "Functional Training TRX",
        classSlug: `trx-${Date.now()}`,
        templateSlug: `template-trx-${Date.now()}`,
        teacherId: giulia.id,
        capacity: 8,
        sessionDaysAgo: [6, 9, 13, 22],
      }),
      createTemplateAndSessions({
        className: "Stretch & Tone Pilates",
        classSlug: `stretch-tone-${Date.now()}`,
        templateSlug: `template-stretch-${Date.now()}`,
        teacherId: ourania.id,
        capacity: 8,
        sessionDaysAgo: [2, 15, 20, 24],
      }),
      createTemplateAndSessions({
        className: "Bonus Balance",
        classSlug: `bonus-balance-${Date.now()}`,
        templateSlug: `template-bonus-${Date.now()}`,
        teacherId: ourania.id,
        capacity: 8,
        sessionDaysAgo: [18, 23],
      }),
    ]);

    const occupancyClass = await createTemplateAndSessions({
      className: "Occupancy Math",
      classSlug: `occupancy-math-${Date.now()}`,
      templateSlug: `template-occupancy-${Date.now()}`,
      teacherId: occupancyCoach.id,
      capacity: 10,
      sessionDaysAgo: [1, 19],
    });

    const allClients = await Promise.all(
      Array.from({ length: 30 }).map((_, index) =>
        createClient(`Client ${index + 1}`, `client.${index + 1}.${Date.now()}@example.test`),
      ),
    );

    const topClients = {
      katalin: await createClient("Katalin", `katalin.${Date.now()}@example.test`),
      maja: await createClient("Maja Simunic", `maja.${Date.now()}@example.test`),
      eline: await createClient("Eline", `eline.${Date.now()}@example.test`),
      batool: await createClient("Batool Dodin", `batool.${Date.now()}@example.test`),
      kriselda: await createClient("Kriselda Deda", `kriselda.${Date.now()}@example.test`),
    };
    const cancelledOnly = await createClient(
      "Cancelled Heavy",
      `cancelled.${Date.now()}@example.test`,
    );

    const atRiskClients = await Promise.all([
      createClient("Engy Sawah", `engy.${Date.now()}@example.test`),
      createClient("Nela O", `nela.${Date.now()}@example.test`),
      createClient("Francesca", `francesca.${Date.now()}@example.test`),
      createClient("Nolwenn Bertrand", `nolwenn.${Date.now()}@example.test`),
      createClient("Svitlana Metelytsia", `svitlana.${Date.now()}@example.test`),
      createClient("Historical Extra", `historical.extra.${Date.now()}@example.test`),
    ]);
    const recoveredClient = await createClient(
      "Recovered Client",
      `recovered.${Date.now()}@example.test`,
    );
    await createClient("Never Booked", `never.${Date.now()}@example.test`);

    const sessionPool = [
      ...pilates.sessions,
      ...rocket.sessions,
      ...vinyasa.sessions,
      ...trx.sessions,
      ...stretch.sessions,
      ...bonus.sessions,
    ];
    const sessionPoolIds = sessionPool.map((session) => session.id);

    const bookingPlan: Array<{ clientId: string; count: number }> = [
      { clientId: topClients.katalin.id, count: 11 },
      { clientId: topClients.maja.id, count: 9 },
      { clientId: topClients.eline.id, count: 7 },
      { clientId: topClients.batool.id, count: 7 },
      { clientId: topClients.kriselda.id, count: 7 },
    ];
    const clientSessionIndex = new Map<string, number>();

    for (const plan of bookingPlan) {
      for (let i = 0; i < plan.count; i += 1) {
        const offset = clientSessionIndex.get(plan.clientId) ?? 0;
        const sessionId = sessionPoolIds[(offset + i) % sessionPoolIds.length];
        await prisma.booking.create({
          data: {
            clientId: plan.clientId,
            studioSessionId: sessionId!,
            status: BookingStatus.CONFIRMED,
            bookedAt: daysAgo(2 + (i % 12)),
          },
        });
      }
      clientSessionIndex.set(plan.clientId, plan.count + 1);
    }

    for (let i = 0; i < 8; i += 1) {
      const sessionId = sessionPoolIds[i % sessionPoolIds.length];
      await prisma.booking.create({
        data: {
          clientId: allClients[i]?.id ?? null,
          studioSessionId: sessionId!,
          status: BookingStatus.CANCELLED,
          bookedAt: daysAgo(3),
          cancelledAt: daysAgo(2),
        },
      });
    }

    for (let i = 0; i < 6; i += 1) {
      const sessionId = sessionPoolIds[(i + 8) % sessionPoolIds.length];
      await prisma.booking.create({
        data: {
          clientId: cancelledOnly.id,
          studioSessionId: sessionId!,
          status: BookingStatus.CANCELLED,
          bookedAt: daysAgo(4),
          cancelledAt: daysAgo(3),
        },
      });
    }

    const historicalStartsAt = daysAgo(45);
    historicalStartsAt.setHours(10, 0, 0, 0);
    const historicalSession = await prisma.studioSession.create({
      data: {
        classTemplateId: pilates.template.id,
        classTypeId: pilates.classType.id,
        teacherId: orsi.id,
        title: "Historical Pilates",
        startsAt: historicalStartsAt,
        endsAt: new Date(historicalStartsAt.getTime() + 60 * 60 * 1000),
        capacity: 12,
        status: StudioSessionStatus.COMPLETED,
        isPublished: true,
      },
    });

    for (const client of atRiskClients) {
      await prisma.booking.create({
        data: {
          clientId: client.id,
          studioSessionId: historicalSession.id,
          status: BookingStatus.COMPLETED,
          bookedAt: daysAgo(44),
        },
      });
    }

    await prisma.booking.create({
      data: {
        clientId: recoveredClient.id,
        studioSessionId: historicalSession.id,
        status: BookingStatus.COMPLETED,
        bookedAt: daysAgo(40),
      },
    });
    await prisma.booking.create({
      data: {
        clientId: recoveredClient.id,
        studioSessionId: sessionPool[0]!.id,
        status: BookingStatus.CONFIRMED,
        bookedAt: daysAgo(5),
      },
    });

    const [occupancySessionOne, occupancySessionTwo] = occupancyClass.sessions;
    const occupancyBookers = allClients.slice(10, 25);
    for (let i = 0; i < 8; i += 1) {
      await prisma.booking.create({
        data: {
          clientId: occupancyBookers[i]!.id,
          studioSessionId: occupancySessionOne!.id,
          status: BookingStatus.CONFIRMED,
          bookedAt: daysAgo(1),
        },
      });
    }
    for (let i = 0; i < 4; i += 1) {
      await prisma.booking.create({
        data: {
          clientId: occupancyBookers[i + 8]!.id,
          studioSessionId: occupancySessionTwo!.id,
          status: BookingStatus.CONFIRMED,
          bookedAt: daysAgo(6),
        },
      });
    }
    await prisma.booking.create({
      data: {
        clientId: occupancyBookers[13]!.id,
        studioSessionId: occupancySessionTwo!.id,
        status: BookingStatus.CANCELLED,
        bookedAt: daysAgo(6),
        cancelledAt: daysAgo(5),
      },
    });

    const insights = await getAdminDashboardInsights("last90Days");

    expect(insights.topClassSessions.length).toBeLessThanOrEqual(5);
    expect(insights.topClassSessions[0]?.classTitle).toBe("Pilates with Props");

    expect(insights.topClients.length).toBeLessThanOrEqual(5);
    expect(insights.topClients[0]?.clientName).toBe("Katalin");
    expect(insights.topClients.some((entry) => entry.clientName === "Cancelled Heavy")).toBe(false);

    expect(insights.atRiskClients.length).toBeLessThanOrEqual(5);
    expect(insights.atRiskClients.some((entry) => entry.clientName === "Never Booked")).toBe(false);
    expect(insights.atRiskClients.some((entry) => entry.clientName === "Recovered Client")).toBe(false);

    const occupancyItem = insights.staffPerformance.find(
      (entry) => entry.staffName === "Occupancy Coach",
    );
    expect(occupancyItem).toBeDefined();
    expect(occupancyItem?.totalBookedPeople).toBe(12);
    expect(occupancyItem?.classesDone).toBe(2);
    expect(occupancyItem?.occupancyRatePercentage).toBe(60);
  });

  it("scopes insights by selected period", async () => {
    const teacher = await createTeacher("Scoped Teacher", `scoped.teacher.${Date.now()}@example.test`);
    const category = await createClassCategory(prisma, {
      name: "Scoped Category",
      slug: `scoped-category-${Date.now()}`,
      sortOrder: 1,
      isActive: true,
    });
    const classType = await createClassType(prisma, {
      categoryId: category.id,
      name: "Scoped Class",
      slug: `scoped-class-${Date.now()}`,
      defaultDurationMinutes: 60,
      pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
      sortOrder: 1,
      isActive: true,
      isVisible: true,
    });
    const template = await prisma.classTemplate.create({
      data: {
        classTypeId: classType.id,
        defaultTeacherId: teacher.id,
        title: "Scoped Class",
        slug: `scoped-template-${Date.now()}`,
        defaultCapacity: 10,
        defaultDurationMinutes: 60,
        isActive: true,
        isPublished: true,
      },
    });
    const last7Date = daysAgo(5);
    last7Date.setHours(9, 0, 0, 0);
    const last30OnlyDate = daysAgo(20);
    last30OnlyDate.setHours(9, 0, 0, 0);
    const last90OnlyDate = daysAgo(70);
    last90OnlyDate.setHours(9, 0, 0, 0);

    const clients = await Promise.all(
      ["Last7 Client", "Last30 Client", "Last90 Client"].map((name, index) =>
        createClient(name, `scoped.client.${index}.${Date.now()}@example.test`),
      ),
    );

    const bookingDates = [last7Date, last30OnlyDate, last90OnlyDate];

    for (let index = 0; index < bookingDates.length; index += 1) {
      const startsAt = bookingDates[index]!;
      const session = await prisma.studioSession.create({
        data: {
          classTemplateId: template.id,
          classTypeId: classType.id,
          teacherId: teacher.id,
          title: "Scoped Class",
          startsAt,
          endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
          capacity: 10,
          status: StudioSessionStatus.COMPLETED,
          isPublished: true,
        },
      });

      await prisma.booking.create({
        data: {
          clientId: clients[index]!.id,
          studioSessionId: session.id,
          status: BookingStatus.CONFIRMED,
          bookedAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        },
      });
    }

    const last7DaysInsights = await getAdminDashboardInsights("last7Days");
    const last30DaysInsights = await getAdminDashboardInsights("last30Days");
    const last90DaysInsights = await getAdminDashboardInsights("last90Days");

    expect(last7DaysInsights.topClients.length).toBe(1);
    expect(last30DaysInsights.topClients.length).toBe(2);
    expect(last90DaysInsights.topClients.length).toBe(3);
  });
});

