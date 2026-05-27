import "./helpers/setup-env";

import { Role, Weekday } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createAdminClass,
  createAdminClassCategory,
  getAdminClassCategoriesData,
  getAdminClassesData,
  getAdminClassById,
  updateAdminClass,
  updateAdminClassImage,
} from "../../src/lib/admin/admin-catalog-core-service";
import { upsertAdminClassScheduleConfig } from "../../src/lib/admin/admin-session-service";
import { getPublicCategories, getPublicServicesByCategorySlug } from "../../src/lib/public-catalogue/catalogue-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin class schedule service", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("saves recurring schedule with dates, times, weekdays and rehydrates without week interval dependency", async () => {
    const [category, teacher] = await Promise.all([
      prisma.classCategory.create({
        data: {
          name: "Yoga",
          slug: `yoga-${Date.now()}`,
          sortOrder: 1,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Teacher One",
          firstName: "Teacher",
          lastName: "One",
          email: `teacher.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    const classType = await createAdminClass({
      categoryId: category.id,
      name: "Morning Flow",
      description: "desc",
      defaultDurationMinutes: 60,
      defaultCapacity: 12,
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    });

    const startDate = new Date("2026-04-07T00:00:00.000Z");
    const endDate = new Date("2026-05-30T00:00:00.000Z");

    await upsertAdminClassScheduleConfig({
      classTypeId: classType.id,
      className: classType.name,
      defaultCapacity: classType.defaultCapacity,
      defaultDurationMinutes: classType.defaultDurationMinutes,
      defaultTeacherId: teacher.id,
      startTime: "09:00",
      endTime: "10:00",
      isRecurring: true,
      date: startDate,
      weekdays: [Weekday.MONDAY, Weekday.THURSDAY],
      endDate,
    });

    const rules = await prisma.recurringRule.findMany({
      where: {
        classTemplate: {
          classTypeId: classType.id,
        },
        isActive: true,
      },
      orderBy: [{ weekday: "asc" }],
      select: {
        weekday: true,
        startDate: true,
        endDate: true,
      },
    });

    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.weekday)).toEqual([Weekday.MONDAY, Weekday.THURSDAY]);
    expect(rules.every((rule) => rule.startDate.toISOString().slice(0, 10) === "2026-04-07")).toBe(true);
    expect(rules.every((rule) => rule.endDate?.toISOString().slice(0, 10) === "2026-05-30")).toBe(true);

    const sessions = await prisma.studioSession.findMany({
      where: {
        classTypeId: classType.id,
      },
      orderBy: [{ startsAt: "asc" }],
      select: {
        startsAt: true,
        endsAt: true,
      },
    });

    expect(sessions.length).toBeGreaterThan(0);
    expect(
      Math.round(((sessions[0]?.endsAt.getTime() ?? 0) - (sessions[0]?.startsAt.getTime() ?? 0)) / (60 * 1000)),
    ).toBe(60);

    const reloaded = await getAdminClassById(classType.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.schedule.isRecurring).toBe(true);
    expect(reloaded?.schedule.startTime).toBe("09:00");
    expect(reloaded?.schedule.endTime).toBe("10:00");
    expect(reloaded?.schedule.weekdays).toEqual([Weekday.MONDAY, Weekday.THURSDAY]);
    expect(reloaded?.schedule.date).toBe("2026-04-07");
    expect(reloaded?.schedule.endDate).toBe("2026-05-30");
    expect("repeatEveryWeeks" in (reloaded?.schedule as unknown as Record<string, unknown>)).toBe(false);
  });

  it("stores class image path reference", async () => {
    const [category, admin] = await Promise.all([
      prisma.classCategory.create({
        data: {
          name: "Pilates",
          slug: `pilates-${Date.now()}`,
          sortOrder: 1,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin One",
          firstName: "Admin",
          lastName: "One",
          email: `admin.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    const classType = await createAdminClass({
      categoryId: category.id,
      name: "Reformer Intro",
      defaultDurationMinutes: 50,
      defaultCapacity: 8,
      isActive: true,
      isVisible: true,
      sortOrder: 2,
    });

    const updated = await updateAdminClassImage({
      classTypeId: classType.id,
      imagePath: "/uploads/classes/reformer-intro-1.jpg",
      adminUserId: admin.id,
    });

    expect(updated.imageUrl).toBe("/uploads/classes/reformer-intro-1.jpg");

    const persisted = await prisma.classType.findUnique({
      where: { id: classType.id },
      select: { imageUrl: true },
    });

    expect(persisted?.imageUrl).toBe("/uploads/classes/reformer-intro-1.jpg");
  });

  it("rejects class image paths outside service media folder", async () => {
    const [category, admin] = await Promise.all([
      prisma.classCategory.create({
        data: {
          name: "Barre",
          slug: `barre-${Date.now()}`,
          sortOrder: 1,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Admin Two",
          firstName: "Admin",
          lastName: "Two",
          email: `admin.two.${Date.now()}@example.test`,
          role: Role.ADMIN,
        },
      }),
    ]);

    await expect(
      createAdminClass({
        categoryId: category.id,
        name: "Barre Basics",
        imageUrl: "/uploads/learning/barre.png",
        defaultDurationMinutes: 45,
        defaultCapacity: 8,
        isActive: true,
        isVisible: true,
        sortOrder: 2,
      }),
    ).rejects.toThrow();

    const classType = await createAdminClass({
      categoryId: category.id,
      name: "Barre Basics",
      defaultDurationMinutes: 45,
      defaultCapacity: 8,
      isActive: true,
      isVisible: true,
      sortOrder: 2,
    });

    await expect(
      updateAdminClassImage({
        classTypeId: classType.id,
        imagePath: "/uploads/learning/barre.png",
        adminUserId: admin.id,
      }),
    ).rejects.toThrow();

    await expect(
      (async () => {
        const created = await createAdminClass({
          categoryId: category.id,
          name: "Barre Basics Updated",
          imageUrl: "/uploads/classes/barre.png",
          defaultDurationMinutes: 45,
          defaultCapacity: 8,
          isActive: true,
          isVisible: true,
          sortOrder: 2,
        });

        return updateAdminClass(created.id, {
          categoryId: category.id,
          name: "Barre Basics Updated",
          imageUrl: "/uploads/learning/barre.png",
          defaultDurationMinutes: 45,
          defaultCapacity: 8,
          isActive: true,
          isVisible: true,
          sortOrder: 2,
        });
      })(),
    ).rejects.toThrow();
  });

  it("creates categories with unique generated slugs and exposes active service categories", async () => {
    const teacher = await prisma.user.create({
      data: {
        name: "Teacher One",
        firstName: "Teacher",
        lastName: "One",
        email: `teacher.category.${Date.now()}@example.test`,
        role: Role.TEACHER,
      },
    });
    const first = await createAdminClassCategory({
      name: "Mind Body",
      description: "Calm classes",
      isActive: true,
      sortOrder: 1,
    });
    const second = await createAdminClassCategory({
      name: "Mind Body",
      isActive: true,
      sortOrder: 2,
    });

    expect(first.slug).toBe("mind-body");
    expect(second.slug).toBe("mind-body-2");

    const classType = await createAdminClass({
      categoryId: first.id,
      name: "Restorative Flow",
      imageUrl: "/uploads/classes/missing-restorative-flow.png",
      defaultDurationMinutes: 60,
      defaultCapacity: 10,
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    });

    await upsertAdminClassScheduleConfig({
      classTypeId: classType.id,
      className: classType.name,
      defaultCapacity: classType.defaultCapacity,
      defaultDurationMinutes: classType.defaultDurationMinutes,
      defaultTeacherId: teacher.id,
      startTime: "11:00",
      endTime: "12:00",
      isRecurring: false,
      date: new Date("2026-05-06T00:00:00.000Z"),
      weekdays: [],
      endDate: null,
    });

    const adminCategories = await getAdminClassCategoriesData();
    expect(adminCategories.find((category) => category.id === first.id)?.serviceCount).toBe(1);

    const publicCategories = await getPublicCategories();
    expect(publicCategories).toEqual(expect.arrayContaining([expect.objectContaining({ slug: "mind-body" })]));

    const publicServices = await getPublicServicesByCategorySlug("mind-body");
    expect(publicServices[0]).toEqual(expect.objectContaining({ slug: "restorative-flow", imageUrl: null }));

    await expect(
      prisma.classCategory.create({
        data: {
          name: "Duplicate",
          slug: "mind-body",
          isActive: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("returns teacher name from class template default teacher for booking services list", async () => {
    const [category, teacher] = await Promise.all([
      prisma.classCategory.create({
        data: {
          name: "Functional",
          slug: `functional-${Date.now()}`,
          sortOrder: 1,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          name: "Sofia Van den Berg",
          firstName: "Sofia",
          lastName: "Van den Berg",
          email: `sofia.${Date.now()}@example.test`,
          role: Role.TEACHER,
        },
      }),
    ]);

    const classWithTeacher = await createAdminClass({
      categoryId: category.id,
      name: "Functional Strength",
      defaultDurationMinutes: 45,
      defaultCapacity: 14,
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    });

    const classWithoutTeacher = await createAdminClass({
      categoryId: category.id,
      name: "Mobility Flow",
      defaultDurationMinutes: 45,
      defaultCapacity: 10,
      isActive: true,
      isVisible: true,
      sortOrder: 2,
    });

    await prisma.classTemplate.create({
      data: {
        classTypeId: classWithTeacher.id,
        defaultTeacherId: teacher.id,
        title: "Functional Strength Schedule",
        slug: `functional-strength-schedule-${Date.now()}`,
        defaultCapacity: 14,
        defaultDurationMinutes: 45,
        isActive: true,
        isPublished: true,
      },
    });

    const items = await getAdminClassesData();
    const withTeacher = items.find((item) => item.id === classWithTeacher.id);
    const withoutTeacher = items.find((item) => item.id === classWithoutTeacher.id);

    expect(withTeacher?.defaultTeacherName).toBe("Sofia Van den Berg");
    expect(withoutTeacher?.defaultTeacherName).toBeNull();
  });
});
