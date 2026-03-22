import "./helpers/setup-env";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";
import { runLearningImport } from "../../scripts/import-learning-platform";

async function runImportWithPayload(payload: unknown) {
  const filePath = join(
    tmpdir(),
    `learning-import-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );

  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");

  const originalArgv = process.argv;
  process.argv = [originalArgv[0] ?? "node", originalArgv[1] ?? "vitest", filePath];

  try {
    await runLearningImport();
  } finally {
    process.argv = originalArgv;
    await rm(filePath, { force: true });
  }
}

describe("learning importer idempotency", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
  });

  afterEach(async () => {
    await prisma.learningCourse.deleteMany();
    await prisma.learningProgram.deleteMany();
  });

  it("is idempotent across repeated runs and updates existing rows without deleting missing payload rows", async () => {
    const payloadV1 = {
      programs: [
        {
          ID: "1",
          MainTitle: "Yoga Program",
          MainDescription: "Initial yoga description",
          CourseType: "Yoga",
          Title: "Yoga",
          Description1: "Yoga one",
        },
        {
          ID: "2",
          MainTitle: "Pilates Program",
          MainDescription: "Initial pilates description",
          CourseType: "Pilates",
          Title: "Pilates",
          Description1: "Pilates one",
        },
      ],
      courses: [
        {
          ID: "101",
          Title: "Sun Flow",
          Description: "Flow description",
          Category: "Yoga",
          Priority: 1,
        },
        {
          ID: "201",
          Title: "Core Burn",
          Description: "Core description",
          Category: "Pilates",
          Priority: 2,
        },
      ],
    };

    await runImportWithPayload(payloadV1);

    expect(await prisma.learningProgram.count()).toBe(2);
    expect(await prisma.learningCourse.count()).toBe(2);

    await runImportWithPayload(payloadV1);

    expect(await prisma.learningProgram.count()).toBe(2);
    expect(await prisma.learningCourse.count()).toBe(2);

    const payloadV3 = {
      programs: [
        {
          ID: "1",
          MainTitle: "Yoga Program Updated",
          MainDescription: "Updated yoga description",
          CourseType: "Yoga",
          Title: "Yoga Updated",
          Description1: "Yoga updated one",
        },
      ],
      courses: [
        {
          ID: "101",
          Title: "Sun Flow Updated",
          Description: "Flow description updated",
          Category: "Yoga",
          Priority: 7,
        },
      ],
    };

    await runImportWithPayload(payloadV3);

    expect(await prisma.learningProgram.count()).toBe(2);
    expect(await prisma.learningCourse.count()).toBe(2);

    const updatedProgram = await prisma.learningProgram.findUnique({ where: { legacyId: "1" } });
    const retainedProgram = await prisma.learningProgram.findUnique({ where: { legacyId: "2" } });
    const updatedCourse = await prisma.learningCourse.findUnique({ where: { legacyId: "101" } });
    const retainedCourse = await prisma.learningCourse.findUnique({ where: { legacyId: "201" } });

    expect(updatedProgram?.mainTitle).toBe("Yoga Program Updated");
    expect(updatedProgram?.title).toBe("Yoga Updated");
    expect(updatedProgram?.mainDescription).toBe("Updated yoga description");

    expect(updatedCourse?.title).toBe("Sun Flow Updated");
    expect(updatedCourse?.description).toBe("Flow description updated");
    expect(updatedCourse?.priority).toBe(7);

    expect(retainedProgram).not.toBeNull();
    expect(retainedProgram?.mainTitle).toBe("Pilates Program");
    expect(retainedCourse).not.toBeNull();
    expect(retainedCourse?.title).toBe("Core Burn");
  });
});
