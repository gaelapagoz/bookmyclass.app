import "./helpers/setup-env";

import { Role, StudioSessionStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import { getKioskTodaySelectableSessions } from "../../src/lib/kiosk/kiosk-service";

describe("kiosk service integration", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only collective sessions for kiosk selection", async () => {
    const [collectiveCategory, privateCategory] = await Promise.all([
      createClassCategory(prisma, {
        name: "Collective",
        slug: `collective-${Date.now()}`,
        sortOrder: 1,
        isActive: true,
      }),
      createClassCategory(prisma, {
        name: "Private",
        slug: `private-${Date.now()}`,
        sortOrder: 2,
        isActive: true,
      }),
    ]);

    const [collectiveType, privateType, teacher] = await Promise.all([
      createClassType(prisma, {
        categoryId: collectiveCategory.id,
        name: "Collective Flow",
        slug: `collective-flow-${Date.now()}`,
        sortOrder: 1,
        isActive: true,
        isVisible: true,
      }),
      createClassType(prisma, {
        categoryId: privateCategory.id,
        name: "Private Flow",
        slug: `private-flow-${Date.now()}`,
        sortOrder: 2,
        isActive: true,
        isVisible: true,
      }),
      prisma.user.create({
        data: {
          name: "Teacher Kiosk",
          email: `teacher.kiosk.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    const [collectiveTemplate, privateTemplate] = await Promise.all([
      prisma.classTemplate.create({
        data: {
          classTypeId: collectiveType.id,
          defaultTeacherId: teacher.id,
          title: "Collective Kiosk Template",
          slug: `collective-kiosk-template-${Date.now()}`,
          defaultCapacity: 10,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
      }),
      prisma.classTemplate.create({
        data: {
          classTypeId: privateType.id,
          defaultTeacherId: teacher.id,
          title: "Private Kiosk Template",
          slug: `private-kiosk-template-${Date.now()}`,
          defaultCapacity: 6,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
      }),
    ]);

    const now = new Date();
    now.setHours(9, 0, 0, 0);
    const collectiveStarts = new Date(now);
    collectiveStarts.setHours(11, 0, 0, 0);
    const privateStarts = new Date(now);
    privateStarts.setHours(12, 0, 0, 0);

    await Promise.all([
      prisma.studioSession.create({
        data: {
          classTemplateId: collectiveTemplate.id,
          classTypeId: collectiveType.id,
          teacherId: teacher.id,
          title: "Collective Kiosk Session",
          startsAt: collectiveStarts,
          endsAt: new Date(collectiveStarts.getTime() + 60 * 60 * 1000),
          capacity: 20,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
      }),
      prisma.studioSession.create({
        data: {
          classTemplateId: privateTemplate.id,
          classTypeId: privateType.id,
          teacherId: teacher.id,
          title: "Private Kiosk Session",
          startsAt: privateStarts,
          endsAt: new Date(privateStarts.getTime() + 60 * 60 * 1000),
          capacity: 6,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
      }),
    ]);

    const sessions = await getKioskTodaySelectableSessions(now);
    const titles = sessions.map((session) => session.title);

    expect(titles).toContain("Collective Kiosk Session");
    expect(titles).not.toContain("Private Kiosk Session");
  });
});
