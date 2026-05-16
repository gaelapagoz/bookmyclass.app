/**
 * Media server verify learning image paths
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/media-server-verify-learning-image-paths.ts
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../src/lib/db";
import { isLearningImagePath } from "../src/lib/learning/image-paths";

type LearningSeed = {
  courses?: Array<{ ID?: string; Thumbnail?: string }>;
  programs?: Array<{
    ID?: string | number;
    Picture1?: string;
    Picture2?: string;
    Picture3?: string;
  }>;
};

function assertLearningImage(value: string | null | undefined, label: string) {
  if (value && !isLearningImagePath(value)) {
    throw new Error(`${label} must use a canonical learning image path under /uploads/learning/*.jpg (legacy /images/learning/* only for migration). Received: ${value}`);
  }
}

async function verifySeedJson() {
  const seedPath = resolve("prisma/seed-data/learning-content.json");
  const raw = await readFile(seedPath, "utf8");
  const seed = JSON.parse(raw) as LearningSeed;

  for (const [index, course] of (seed.courses ?? []).entries()) {
    assertLearningImage(course.Thumbnail, `seed course ${course.ID ?? index} thumbnail`);
  }

  for (const [index, program] of (seed.programs ?? []).entries()) {
    assertLearningImage(program.Picture1, `seed program ${program.ID ?? index} picture1`);
    assertLearningImage(program.Picture2, `seed program ${program.ID ?? index} picture2`);
    assertLearningImage(program.Picture3, `seed program ${program.ID ?? index} picture3`);
  }
}

async function verifyDatabase() {
  const [courses, programs] = await Promise.all([
    prisma.learningCourse.findMany({
      select: {
        legacyId: true,
        thumbnail: true,
      },
    }),
    prisma.learningProgram.findMany({
      select: {
        legacyId: true,
        picture1: true,
        picture2: true,
        picture3: true,
      },
    }),
  ]);

  for (const course of courses) {
    assertLearningImage(course.thumbnail, `db learningCourse ${course.legacyId} thumbnail`);
  }

  for (const program of programs) {
    assertLearningImage(program.picture1, `db learningProgram ${program.legacyId} picture1`);
    assertLearningImage(program.picture2, `db learningProgram ${program.legacyId} picture2`);
    assertLearningImage(program.picture3, `db learningProgram ${program.legacyId} picture3`);
  }
}

async function main() {
  await verifySeedJson();
  await verifyDatabase();
  console.log("[verify-learning-image-paths] OK");
}

main()
  .catch((error) => {
    console.error("[verify-learning-image-paths][FAIL]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
