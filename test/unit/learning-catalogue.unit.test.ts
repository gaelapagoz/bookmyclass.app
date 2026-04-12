import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    learningProgram: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    learningCourse: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  default: dbMock,
  prisma: dbMock,
}));

import {
  fromCourseTypeRouteKey,
  getLearningCourseByCourseTypeAndLegacyId,
  getLearningProgramByCourseType,
  getLearningPrograms,
  toCourseTypeRouteKey,
} from "../../src/lib/learning/catalogue";

describe("learning catalogue data layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getLearningPrograms returns mapped programs and queries in legacyId order", async () => {
    dbMock.learningProgram.findMany.mockResolvedValue([
      {
        legacyId: "1",
        mainTitle: "Program A",
        mainDescription: "A",
        courseType: "Yoga",
        title: "Program A",
        description1: null,
        description2: null,
        description3: null,
        videoPromo: null,
        picture1: "/images/learning/p1.jpg",
        picture2: null,
        picture3: null,
      },
      {
        legacyId: "2",
        mainTitle: "Program B",
        mainDescription: "B",
        courseType: "Pilates",
        title: "Program B",
        description1: null,
        description2: null,
        description3: null,
        videoPromo: null,
        picture1: "/images/outside-learning/p2.jpg",
        picture2: null,
        picture3: null,
      },
    ]);

    const programs = await getLearningPrograms();

    expect(dbMock.learningProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { legacyId: "asc" },
      }),
    );
    expect(programs).toHaveLength(2);
    expect(programs[0].picture1).toBe("/images/learning/p1.jpg");
    expect(programs[1].picture1).toBeNull();
  });

  it("drops invalid learning program image paths from runtime views", async () => {
    dbMock.learningProgram.findMany.mockResolvedValue([
      {
        legacyId: "5",
        mainTitle: "Online Yoga Classes",
        mainDescription: "A",
        courseType: "Yoga",
        title: "Program A",
        description1: null,
        description2: null,
        description3: null,
        videoPromo: null,
        picture1: "/images/online-yoga-image-1.jpg",
        picture2: null,
        picture3: null,
      },
    ]);

    const programs = await getLearningPrograms();

    expect(programs[0].picture1).toBeNull();
  });

  it("getLearningProgramByCourseType returns the matching program", async () => {
    dbMock.learningProgram.findUnique.mockResolvedValue({
      legacyId: "3",
      mainTitle: "Backbends",
      mainDescription: "desc",
      courseType: "Backbend",
      title: "Backbends",
      description1: "d1",
      description2: "d2",
      description3: "d3",
      videoPromo: "https://www.youtube.com/watch?v=abc",
      picture1: null,
      picture2: null,
      picture3: null,
    });

    const program = await getLearningProgramByCourseType("Backbend");

    expect(dbMock.learningProgram.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseType: "Backbend" },
      }),
    );
    expect(program?.mainTitle).toBe("Backbends");
  });

  it("route key helpers roundtrip consistently", () => {
    const courseType = "Body Sculpting Pilates Series";
    const routeKey = toCourseTypeRouteKey(courseType);
    const roundtrip = fromCourseTypeRouteKey(routeKey);

    expect(routeKey).toBe("Body%20Sculpting%20Pilates%20Series");
    expect(roundtrip).toBe(courseType);
  });

  it("getLearningCourseByCourseTypeAndLegacyId returns course for valid combination", async () => {
    dbMock.learningCourse.findUnique.mockResolvedValue({
      legacyId: "course-1",
      title: "Core Flow",
      description: "desc",
      shortDescription: "short",
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: "/images/learning/t.jpg",
      videoUrl: "https://www.youtube.com/watch?v=abc",
      priority: 1,
    });

    const course = await getLearningCourseByCourseTypeAndLegacyId("Yoga", "course-1");

    expect(dbMock.learningCourse.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { legacyId: "course-1" },
      }),
    );
    expect(course?.legacyId).toBe("course-1");
    expect(course?.thumbnail).toBe("/images/learning/t.jpg");
  });

  it("drops invalid learning thumbnails from runtime views", async () => {
    dbMock.learningCourse.findUnique.mockResolvedValue({
      legacyId: "06369c36-bc85-48ef-9b3a-c40c9175efe3",
      title: "Core Flow",
      description: "desc",
      shortDescription: "short",
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: "/images/course-thumb.jpg",
      videoUrl: "https://www.youtube.com/watch?v=abc",
      priority: 1,
    });

    const course = await getLearningCourseByCourseTypeAndLegacyId(
      "Yoga",
      "06369c36-bc85-48ef-9b3a-c40c9175efe3",
    );

    expect(course?.thumbnail).toBeNull();
  });

  it("preserves first-party learning thumbnails under /images/learning", async () => {
    dbMock.learningCourse.findUnique.mockResolvedValue({
      legacyId: "course-3",
      title: "Core Flow",
      description: "desc",
      shortDescription: "short",
      category: "Yoga",
      categoryType: null,
      categoryLevel: null,
      thumbnail: "/images/learning/core-flow.jpg",
      videoUrl: "https://www.youtube.com/watch?v=abc",
      priority: 1,
    });

    const course = await getLearningCourseByCourseTypeAndLegacyId("Yoga", "course-3");
    expect(course?.thumbnail).toBe("/images/learning/core-flow.jpg");
  });

  it("returns null for missing program or mismatched/missing course", async () => {
    dbMock.learningProgram.findUnique.mockResolvedValueOnce(null);
    const missingProgram = await getLearningProgramByCourseType("Unknown");
    expect(missingProgram).toBeNull();

    dbMock.learningCourse.findUnique.mockResolvedValueOnce(null);
    const missingCourse = await getLearningCourseByCourseTypeAndLegacyId(
      "Yoga",
      "missing",
    );
    expect(missingCourse).toBeNull();

    dbMock.learningCourse.findUnique.mockResolvedValueOnce({
      legacyId: "course-2",
      title: "Pilates Base",
      description: null,
      shortDescription: null,
      category: "Pilates",
      categoryType: null,
      categoryLevel: null,
      thumbnail: null,
      videoUrl: null,
      priority: 5,
    });
    const mismatchedCourse = await getLearningCourseByCourseTypeAndLegacyId(
      "Yoga",
      "course-2",
    );
    expect(mismatchedCourse).toBeNull();
  });
});

