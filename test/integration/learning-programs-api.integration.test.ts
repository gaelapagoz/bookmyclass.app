import "./helpers/setup-env";

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";
import { GET as getPrograms } from "../../src/app/api/programs/route";

describe("GET /api/programs", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-learning-programs-"));
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PUBLIC_UPLOADS_BASE_PATH = "/uploads";
    await mkdir(path.join(uploadsDir, "learning"), { recursive: true });
    for (const file of ["a1.jpg", "a2.jpg", "a3.jpg", "b1.jpg", "b2.jpg", "b3.jpg", "program-c.jpg"]) {
      await writeFile(path.join(uploadsDir, "learning", file), Buffer.from([0xff, 0xd8, 0xff]));
    }
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
        picture1: "/uploads/learning/b1.jpg",
        picture2: "/uploads/learning/b2.jpg",
        picture3: "/uploads/learning/b3.jpg",
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
        picture1: "/uploads/learning/a1.jpg",
        picture2: "/uploads/learning/a2.jpg",
        picture3: "/uploads/learning/a3.jpg",
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
      Picture1: "/uploads/learning/a1.jpg",
      Picture2: "/uploads/learning/a2.jpg",
      Picture3: "/uploads/learning/a3.jpg",
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
        picture1: "/uploads/program.jpg",
        picture2: "/uploads/classes/not-learning.jpg",
        picture3: "/uploads/learning/program-c.jpg",
      },
    });

    const response = await getPrograms();
    const body = (await response.json()) as Array<Record<string, unknown>>;
    const program = body.find((entry) => entry.ID === "3");

    expect(program).toMatchObject({
      Picture1: null,
      Picture2: null,
      Picture3: "/uploads/learning/program-c.jpg",
    });
  });

  it("returns an empty array when no programs exist", async () => {
    const response = await getPrograms();
    const body = (await response.json()) as Array<unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual([]);
  });
});
