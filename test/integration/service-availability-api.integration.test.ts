import "./helpers/setup-env";
import { BookingStatus, Role, StudioSessionStatus, Weekday } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { GET as getServiceBySlug } from "../../src/app/api/services/[slug]/route";
import { GET as getServiceAvailability } from "../../src/app/api/services/[slug]/availability/route";
import { GET as getServiceSlots } from "../../src/app/api/services/[slug]/slots/route";
import { GET as getNextAvailability } from "../../src/app/api/services/[slug]/next-availability/route";
import { getStudioDateKey, getStudioMonthKey } from "../../src/lib/public-catalogue/timezone";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType, createClient } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createAvailabilityFixture() {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: "yoga",
    sortOrder: 1,
    isActive: true,
  });
  const service = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: "vinyasa-yoga",
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: "teacher.availability@example.test",
      role: Role.TEACHER,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: service.id,
      defaultTeacherId: teacher.id,
      title: "Vinyasa Flow",
      slug: "vinyasa-flow-template",
      description: "Flow class",
      defaultCapacity: 2,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const recurringRule = await prisma.recurringRule.create({
    data: {
      classTemplateId: template.id,
      weekday: Weekday.MONDAY,
      startTime: "18:30",
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      isActive: true,
    },
  });

  const now = new Date();
  const firstSessionStart = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  firstSessionStart.setUTCMinutes(0, 0, 0);
  firstSessionStart.setUTCHours(17, 0, 0, 0);
  const firstSessionEnd = new Date(firstSessionStart.getTime() + 60 * 60 * 1000);

  const secondSessionStart = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  secondSessionStart.setUTCMinutes(0, 0, 0);
  secondSessionStart.setUTCHours(19, 0, 0, 0);
  const secondSessionEnd = new Date(secondSessionStart.getTime() + 60 * 60 * 1000);

  const firstSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      recurringRuleId: recurringRule.id,
      classTypeId: service.id,
      teacherId: teacher.id,
      title: "Vinyasa Evening",
      startsAt: firstSessionStart,
      endsAt: firstSessionEnd,
      capacity: 2,
      isPublished: true,
      status: StudioSessionStatus.SCHEDULED,
    },
  });

  const secondSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      recurringRuleId: recurringRule.id,
      classTypeId: service.id,
      teacherId: teacher.id,
      title: "Vinyasa Power",
      startsAt: secondSessionStart,
      endsAt: secondSessionEnd,
      capacity: 1,
      isPublished: true,
      status: StudioSessionStatus.SCHEDULED,
    },
  });

  const clientOne = await createClient(prisma);
  await prisma.booking.create({
    data: {
      clientId: clientOne.id,
      studioSessionId: firstSession.id,
      status: BookingStatus.CONFIRMED,
      customerEmail: clientOne.email,
      customerName: clientOne.name,
    },
  });

  const clientTwo = await createClient(prisma);
  await prisma.booking.create({
    data: {
      clientId: clientTwo.id,
      studioSessionId: secondSession.id,
      status: BookingStatus.CONFIRMED,
      customerEmail: clientTwo.email,
      customerName: clientTwo.name,
    },
  });

  return {
    serviceSlug: service.slug,
    firstDateKey: getStudioDateKey(firstSessionStart),
    secondDateKey: getStudioDateKey(secondSessionStart),
    monthKey: getStudioMonthKey(firstSessionStart),
  };
}

describe("service availability api", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns service details by slug", async () => {
    const fixture = await createAvailabilityFixture();

    const response = await getServiceBySlug(new Request("http://localhost/api"), {
      params: Promise.resolve({ slug: fixture.serviceSlug }),
    });
    const body = (await response.json()) as {
      service: { slug: string; title: string } | null;
    };

    expect(response.status).toBe(200);
    expect(body.service?.slug).toBe(fixture.serviceSlug);
    expect(body.service?.title).toBe("Vinyasa Yoga");
  });

  it("returns month availability with capacity-aware counts", async () => {
    const fixture = await createAvailabilityFixture();

    const response = await getServiceAvailability(
      new Request(`http://localhost/api/services/${fixture.serviceSlug}/availability?month=${fixture.monthKey}`),
      {
        params: Promise.resolve({ slug: fixture.serviceSlug }),
      },
    );
    const body = (await response.json()) as {
      days: Array<{ availableSlots: number; date: string; hasAvailability: boolean; totalSlots: number }>;
      month: string;
    };

    expect(response.status).toBe(200);
    expect(body.month).toBe(fixture.monthKey);
    expect(body.days.length).toBeGreaterThanOrEqual(2);
    expect(body.days.some((day) => day.date === fixture.firstDateKey && day.hasAvailability)).toBe(true);
    expect(body.days.some((day) => day.date === fixture.secondDateKey && !day.hasAvailability)).toBe(true);
  });

  it("returns slots for an available day and empty list for a day without sessions", async () => {
    const fixture = await createAvailabilityFixture();

    const availableResponse = await getServiceSlots(
      new Request(`http://localhost/api/services/${fixture.serviceSlug}/slots?date=${fixture.firstDateKey}`),
      {
        params: Promise.resolve({ slug: fixture.serviceSlug }),
      },
    );
    const availableBody = (await availableResponse.json()) as {
      slots: Array<{ isAvailable: boolean }>;
    };

    expect(availableResponse.status).toBe(200);
    expect(availableBody.slots.length).toBeGreaterThan(0);
    expect(availableBody.slots[0]?.isAvailable).toBe(true);

    const emptyDate = "2099-01-01";
    const emptyResponse = await getServiceSlots(
      new Request(`http://localhost/api/services/${fixture.serviceSlug}/slots?date=${emptyDate}`),
      {
        params: Promise.resolve({ slug: fixture.serviceSlug }),
      },
    );
    const emptyBody = (await emptyResponse.json()) as { slots: Array<unknown> };

    expect(emptyResponse.status).toBe(200);
    expect(emptyBody.slots).toEqual([]);
  });

  it("returns next available slot from a given date", async () => {
    const fixture = await createAvailabilityFixture();

    const response = await getNextAvailability(
      new Request(`http://localhost/api/services/${fixture.serviceSlug}/next-availability?from=${fixture.firstDateKey}`),
      {
        params: Promise.resolve({ slug: fixture.serviceSlug }),
      },
    );
    const body = (await response.json()) as {
      next: { date: string; isAvailable: boolean } | null;
    };

    expect(response.status).toBe(200);
    expect(body.next).not.toBeNull();
    expect(body.next?.isAvailable).toBe(true);
  });

  it("handles invalid input safely", async () => {
    const badMonthResponse = await getServiceAvailability(
      new Request("http://localhost/api/services/invalid/availability?month=2026-13"),
      { params: Promise.resolve({ slug: "invalid" }) },
    );
    const badDateResponse = await getServiceSlots(
      new Request("http://localhost/api/services/invalid/slots?date=2026-99-99"),
      { params: Promise.resolve({ slug: "invalid" }) },
    );

    expect(badMonthResponse.status).toBe(400);
    expect(badDateResponse.status).toBe(400);
  });
});




