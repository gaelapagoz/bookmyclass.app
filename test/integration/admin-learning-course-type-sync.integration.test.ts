import "./helpers/setup-env";

import { beforeEach, describe, expect, it } from "vitest";

import {
  getAdminLearningVideosData,
  updateAdminLearningProgram,
} from "../../src/lib/admin/admin-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("admin learning program/video course-type synchronization", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
  });

  it("propagates learning program courseType rename to related videos", async () => {
    const program = await prisma.learningProgram.create({
      data: {
        legacyId: "program-1",
        courseType: "Backbend",
        mainDescription: "desc",
      },
    });

    await prisma.learningCourse.createMany({
      data: [
        {
          legacyId: "video-1",
          title: "Video 1",
          category: "Backbend",
          priority: 1,
        },
        {
          legacyId: "video-2",
          title: "Video 2",
          category: "Backbend",
          priority: 2,
        },
        {
          legacyId: "video-3",
          title: "Other Program Video",
          category: "Online Yoga Classes",
          priority: 1,
        },
      ],
    });

    await updateAdminLearningProgram(program.id, {
      courseType: "Backbends Series",
      mainDescription: "desc updated",
      description1: undefined,
      description2: undefined,
      description3: undefined,
      videoPromo: undefined,
      picture1: undefined,
      picture2: undefined,
      picture3: undefined,
    });

    const renamedCategoryVideos = await prisma.learningCourse.findMany({
      where: { category: "Backbends Series" },
      orderBy: { legacyId: "asc" },
      select: { legacyId: true },
    });
    const staleCategoryVideos = await prisma.learningCourse.findMany({
      where: { category: "Backbend" },
      select: { legacyId: true },
    });
    const unrelatedVideo = await prisma.learningCourse.findUnique({
      where: { legacyId: "video-3" },
      select: { category: true },
    });

    expect(renamedCategoryVideos.map((item) => item.legacyId)).toEqual(["video-1", "video-2"]);
    expect(staleCategoryVideos).toHaveLength(0);
    expect(unrelatedVideo?.category).toBe("Online Yoga Classes");
  });

  it("orders videos by courseType, then priority, then title, then id", async () => {
    await prisma.learningCourse.createMany({
      data: [
        {
          legacyId: "v-1",
          title: "B title",
          category: "Backbends Series",
          priority: 2,
        },
        {
          legacyId: "v-2",
          title: "A title",
          category: "Backbends Series",
          priority: 2,
        },
        {
          legacyId: "v-3",
          title: "C title",
          category: "Backbends Series",
          priority: 1,
        },
        {
          legacyId: "v-4",
          title: "Yoga title",
          category: "Online Yoga Classes",
          priority: 1,
        },
      ],
    });

    const videos = await getAdminLearningVideosData();

    expect(videos.map((item) => `${item.category}|${item.priority}|${item.title}`)).toEqual([
      "Backbends Series|1|C title",
      "Backbends Series|2|A title",
      "Backbends Series|2|B title",
      "Online Yoga Classes|1|Yoga title",
    ]);
  });
});

