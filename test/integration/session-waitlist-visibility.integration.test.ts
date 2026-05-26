import "./helpers/setup-env";

import { Role, StudioSessionStatus, WaitlistStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { getAdminSessionsData } from "../../src/lib/admin/admin-service";
import { getTeacherAssignedSessions } from "../../src/lib/teacher/teacher-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

async function createSessionFixture() {
  const category = await createClassCategory(prisma, {
    name: "Collective",
    slug: `waitlist-visibility-collective-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });

  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Waitlist Visibility Class",
    slug: `waitlist-visibility-class-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Visibility Teacher",
      email: `visibility.teacher.${Date.now()}@example.test`,
      role: Role.TEACHER,
      teacherProfile: { create: {} },
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Waitlist Visibility Template",
      slug: `waitlist-visibility-template-${Date.now()}`,
      defaultCapacity: 10,
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
      title: "Waitlist Visibility Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 2,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
    select: {
      id: true,
      startsAt: true,
      teacherId: true,
    },
  });

  const clients = [] as Array<{ id: string }>;
  for (let index = 0; index < 4; index += 1) {
    const client = await prisma.user.create({
      data: {
        name: `Waitlist Visibility Client ${index + 1}`,
        email: `waitlist.visibility.${Date.now()}.${index + 1}@example.test`,
        role: Role.CLIENT,
      },
      select: { id: true },
    });
    clients.push(client);
  }

  await prisma.waitlistEntry.create({
    data: {
      clientId: clients[0]!.id,
      studioSessionId: session.id,
      status: WaitlistStatus.ACTIVE,
      position: 1,
    },
  });
  await prisma.waitlistEntry.create({
    data: {
      clientId: clients[1]!.id,
      studioSessionId: session.id,
      status: WaitlistStatus.ACTIVE,
      position: 2,
    },
  });
  await prisma.waitlistEntry.create({
    data: {
      clientId: clients[2]!.id,
      studioSessionId: session.id,
      status: WaitlistStatus.CANCELLED,
      position: 3,
    },
  });
  await prisma.waitlistEntry.create({
    data: {
      clientId: clients[3]!.id,
      studioSessionId: session.id,
      status: WaitlistStatus.PROMOTED,
      position: 4,
    },
  });

  return {
    sessionId: session.id,
    weekStart: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
    weekEnd: new Date(startsAt.getTime() + 24 * 60 * 60 * 1000),
    teacherId: session.teacherId,
  };
}

describe("session waitlist visibility read models", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("includes only active waitlist entries in admin session projection", async () => {
    const fixture = await createSessionFixture();

    const sessions = await getAdminSessionsData({
      weekStart: fixture.weekStart,
      weekEnd: fixture.weekEnd,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(fixture.sessionId);
    expect(sessions[0]?.waitlistCount).toBe(2);
  });

  it("includes only active waitlist entries in teacher assigned sessions projection", async () => {
    const fixture = await createSessionFixture();

    const sessions = await getTeacherAssignedSessions({
      teacherUserId: fixture.teacherId,
      weekStart: fixture.weekStart,
      weekEnd: fixture.weekEnd,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(fixture.sessionId);
    expect(sessions[0]?.waitlistCount).toBe(2);
  });
});
