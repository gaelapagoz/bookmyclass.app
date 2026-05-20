import "./helpers/setup-env";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";
import { GET as getPrograms } from "../../src/app/api/programs/route";

describe("GET /api/programs", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
  });

  it("returns legacy-shaped programs ordered by legacyId ascending", async () => {
    await prisma.learningProgram.create({
      data: {
        legacyId: "2",
        mainDescription: "desc b",
        courseType: "Pilates",
        description1: "d1b",
        description2: "d2b",
        description3: "d3b",
        videoPromo: "https://www.youtube.com/watch?v=b",
        picture1: "/images/learning/b1.jpg",
        picture2: "/images/learning/b2.jpg",
        picture3: "/images/learning/b3.jpg",
      },
    });

    await prisma.learningProgram.create({
      data: {
        legacyId: "1",
        mainDescription: "desc a",
        courseType: "Yoga",
        description1: "d1a",
        description2: "d2a",
        description3: "d3a",
        videoPromo: "https://www.youtube.com/watch?v=a",
        picture1: "/images/learning/a1.jpg",
        picture2: "/images/learning/a2.jpg",
        picture3: "/images/learning/a3.jpg",
      },
    });

    const response = await getPrograms();
    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0]?.ID).toBe("1");
    expect(body[1]?.ID).toBe("2");

    expect(body[0]).toMatchObject({
      ID: "1",
      MainTitle: "Yoga",
      MainDescription: "desc a",
      CourseType: "Yoga",
      Title: "Yoga",
      Description1: "d1a",
      Description2: "d2a",
      Description3: "d3a",
      VideoPromo: "https://www.youtube.com/watch?v=a",
      Picture1: "/images/learning/a1.jpg",
      Picture2: "/images/learning/a2.jpg",
      Picture3: "/images/learning/a3.jpg",
    });
  });

  it("filters invalid program image paths out of the API response", async () => {
    await prisma.learningProgram.create({
      data: {
        legacyId: "3",
        mainDescription: "desc c",
        courseType: "Mobility",
        description1: "d1c",
        description2: "d2c",
        description3: "d3c",
        videoPromo: "https://www.youtube.com/watch?v=c",
        picture1: "/images/program.jpg",
        picture2: "/images/not-learning.jpg",
        picture3: "/images/learning/program-c.jpg",
      },
    });

    const response = await getPrograms();
    const body = (await response.json()) as Array<Record<string, unknown>>;
    const program = body.find((entry) => entry.ID === "3");

    expect(program).toMatchObject({
      Picture1: null,
      Picture2: null,
      Picture3: "/images/learning/program-c.jpg",
    });
  });

  it("returns an empty array when no programs exist", async () => {
    const response = await getPrograms();
    const body = (await response.json()) as Array<unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});

