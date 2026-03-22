import "./helpers/setup-env";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";
import { GET as getCourses } from "../../src/app/api/courses/route";

describe("GET /api/courses", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
  });

  it("returns legacy-shaped courses ordered by priority then title", async () => {
    await prisma.learningCourse.createMany({
      data: [
        {
          legacyId: "c3",
          title: "Zeta",
          description: "desc zeta",
          shortDescription: "short zeta",
          category: "Yoga",
          categoryType: "Flow",
          categoryLevel: "Beginner",
          thumbnail: "/images/zeta.jpg",
          videoUrl: "https://www.youtube.com/watch?v=zeta",
          priority: 2,
        },
        {
          legacyId: "c1",
          title: "Alpha",
          description: "desc alpha",
          shortDescription: "short alpha",
          category: "Yoga",
          categoryType: "Flow",
          categoryLevel: "Beginner",
          thumbnail: "/images/alpha.jpg",
          videoUrl: "https://www.youtube.com/watch?v=alpha",
          priority: 1,
        },
        {
          legacyId: "c2",
          title: "Beta",
          description: "desc beta",
          shortDescription: "short beta",
          category: "Yoga",
          categoryType: "Flow",
          categoryLevel: "Intermediate",
          thumbnail: "/images/beta.jpg",
          videoUrl: "https://www.youtube.com/watch?v=beta",
          priority: 1,
        },
      ],
    });

    const response = await getCourses();
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(3);
    expect(body.map((entry) => entry.ID)).toEqual(["c1", "c2", "c3"]);

    expect(body[0]).toMatchObject({
      ID: "c1",
      Title: "Alpha",
      Description: "desc alpha",
      "Short Description": "short alpha",
      Category: "Yoga",
      "Category Type": "Flow",
      "Category Level": "Beginner",
      Thumbnail: "/images/alpha.jpg",
      VideoURL: "https://www.youtube.com/watch?v=alpha",
      Priority: 1,
    });
  });

  it("returns an empty array when no courses exist", async () => {
    const response = await getCourses();
    const body = (await response.json()) as Array<unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});
