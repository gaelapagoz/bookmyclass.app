import "./helpers/setup-env";

import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Role, UserActivationStatus } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMediaBackfill } from "../../src/lib/media/media-backfill-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

type FixtureState = {
  userId: string;
  classTypeId: string;
  programId: string;
  courseId: string;
  mediaAssetId: string;
  legacyPublicDir: string;
};

const tempDirs: string[] = [];

async function writeFixtureFile(root: string, relativePath: string): Promise<void> {
  const absolutePath = path.resolve(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from([1, 2, 3, 4]));
}

async function seedBackfillFixtures(legacyPublicDir: string): Promise<FixtureState> {
  const legacyTeacherImage = ["/images", "instructors", "teacher-legacy.jpg"].join("/");
  const legacyClassImage = ["/images", "classes", "class-legacy.png"].join("/");
  const legacyProgramImage = ["/images", "learning", "program-legacy.webp"].join("/");
  const legacyCourseImage = ["/images", "learning", "course-legacy.jpg"].join("/");
  const admin = await prisma.user.create({
    data: {
      name: "Backfill Admin",
      email: `backfill.admin.${Date.now()}@example.test`,
      role: Role.ADMIN,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });

  const user = await prisma.user.create({
    data: {
      name: "Legacy Teacher",
      email: `legacy.teacher.${Date.now()}@example.test`,
      role: Role.TEACHER,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
      image: legacyTeacherImage,
    },
    select: { id: true },
  });

  const category = await prisma.classCategory.create({
    data: {
      name: "Pilates",
      slug: `pilates-${Date.now()}`,
      isActive: true,
      sortOrder: 1,
    },
    select: { id: true },
  });

  const classType = await prisma.classType.create({
    data: {
      categoryId: category.id,
      name: "Mat",
      slug: `mat-${Date.now()}`,
      imageUrl: legacyClassImage,
      defaultDurationMinutes: 60,
      defaultCapacity: 12,
      isActive: true,
      isVisible: true,
      sortOrder: 1,
    },
    select: { id: true },
  });

  const program = await prisma.learningProgram.create({
    data: {
      legacyId: `program-${Date.now()}`,
      courseType: `course-type-${Date.now()}`,
      picture1: legacyProgramImage,
    },
    select: { id: true },
  });

  const course = await prisma.learningCourse.create({
    data: {
      legacyId: `course-${Date.now()}`,
      title: "Course",
      category: "Intermediate",
      thumbnail: legacyCourseImage,
    },
    select: { id: true },
  });

  const mediaAsset = await prisma.mediaAsset.create({
    data: {
      path: "/uploads/products/product-legacy.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      originalFilename: "product-legacy.jpg",
      storageFilename: `product-legacy-${Date.now()}.jpg`,
      uploadedById: admin.id,
    },
    select: { id: true },
  });

  await writeFixtureFile(legacyPublicDir, "images/instructors/teacher-legacy.jpg");
  await writeFixtureFile(legacyPublicDir, "images/classes/class-legacy.png");
  await writeFixtureFile(legacyPublicDir, "images/learning/program-legacy.webp");
  await writeFixtureFile(legacyPublicDir, "images/learning/course-legacy.jpg");
  await writeFixtureFile(legacyPublicDir, "uploads/products/product-legacy.jpg");

  return {
    userId: user.id,
    classTypeId: classType.id,
    programId: program.id,
    courseId: course.id,
    mediaAssetId: mediaAsset.id,
    legacyPublicDir,
  };
}

describe("media backfill integration", () => {
  beforeEach(async () => {
    await resetDb();
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-m6-uploads-"));
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-m6-public-"));
    tempDirs.push(uploadsDir, legacyDir);
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");
  });

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
    vi.unstubAllEnvs();
  });

  it("supports dry-run first, then apply, and remains idempotent on rerun", async () => {
    const legacyPublicDir = tempDirs[1];
    const state = await seedBackfillFixtures(legacyPublicDir);

    const dryRun = await runMediaBackfill({
      prisma,
      apply: false,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(dryRun.summary.candidates).toBe(5);
    expect(dryRun.summary.toCopyAndUpdate).toBe(5);
    expect(dryRun.summary.applied).toBe(0);

    const dryRunUser = await prisma.user.findUnique({ where: { id: state.userId }, select: { image: true } });
    expect(dryRunUser?.image).toBe(["/images", "instructors", "teacher-legacy.jpg"].join("/"));

    const applyResult = await runMediaBackfill({
      prisma,
      apply: true,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(applyResult.summary.candidates).toBe(5);
    expect(applyResult.summary.applied).toBe(5);
    expect(applyResult.summary.toCopyAndUpdate).toBe(5);

    const updatedUser = await prisma.user.findUnique({ where: { id: state.userId }, select: { image: true } });
    const updatedClassType = await prisma.classType.findUnique({ where: { id: state.classTypeId }, select: { imageUrl: true } });
    const updatedProgram = await prisma.learningProgram.findUnique({ where: { id: state.programId }, select: { picture1: true } });
    const updatedCourse = await prisma.learningCourse.findUnique({ where: { id: state.courseId }, select: { thumbnail: true } });
    const unchangedMediaAsset = await prisma.mediaAsset.findUnique({ where: { id: state.mediaAssetId }, select: { path: true } });

    expect(updatedUser?.image).toBe("/uploads/teachers/teacher-legacy.jpg");
    expect(updatedClassType?.imageUrl).toBe("/uploads/classes/class-legacy.png");
    expect(updatedProgram?.picture1).toBe("/uploads/learning/program-legacy.webp");
    expect(updatedCourse?.thumbnail).toBe("/uploads/learning/course-legacy.jpg");
    expect(unchangedMediaAsset?.path).toBe("/uploads/products/product-legacy.jpg");

    for (const candidate of applyResult.applied) {
      expect(candidate.toPath.startsWith("/uploads/")).toBe(true);
      expect(existsSync(candidate.targetAbsolutePath)).toBe(true);
    }

    const rerun = await runMediaBackfill({
      prisma,
      apply: true,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(rerun.summary.candidates).toBe(1);
    expect(rerun.summary.alreadyCopied).toBe(1);
    expect(rerun.summary.toCopyAndUpdate).toBe(0);
    expect(rerun.summary.applied).toBe(0);
  });

  it("updates legacy DB path even when target file already exists", async () => {
    const legacyPublicDir = tempDirs[1];
    const state = await seedBackfillFixtures(legacyPublicDir);

    await mkdir(path.dirname(path.join(tempDirs[0], "teachers", "teacher-legacy.jpg")), { recursive: true });
    await writeFile(path.join(tempDirs[0], "teachers", "teacher-legacy.jpg"), Buffer.from([8, 8, 8, 8]));

    const result = await runMediaBackfill({
      prisma,
      apply: true,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(result.summary.alreadyCopied).toBe(1);
    expect(result.dbUpdateOnly.length).toBeGreaterThanOrEqual(1);
    expect(result.applied.some((candidate) => candidate.entity === "User" && candidate.id === state.userId)).toBe(true);

    const updatedUser = await prisma.user.findUnique({ where: { id: state.userId }, select: { image: true } });
    expect(updatedUser?.image).toBe("/uploads/teachers/teacher-legacy.jpg");
  });

  it("reports missing sources and skips mutation when source and target are absent", async () => {
    const legacyPublicDir = tempDirs[1];
    const state = await seedBackfillFixtures(legacyPublicDir);

    await rm(path.join(legacyPublicDir, "images", "instructors", "teacher-legacy.jpg"), { force: true });

    const dryRun = await runMediaBackfill({
      prisma,
      apply: false,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(dryRun.summary.missingSources).toBe(1);
    expect(dryRun.summary.toCopyAndUpdate).toBe(4);

    const applyResult = await runMediaBackfill({
      prisma,
      apply: true,
      legacyPublicDir: state.legacyPublicDir,
    });

    expect(applyResult.summary.missingSources).toBe(1);
    expect(applyResult.applied.some((candidate) => candidate.entity === "User" && candidate.id === state.userId)).toBe(false);

    const user = await prisma.user.findUnique({ where: { id: state.userId }, select: { image: true } });
    expect(user?.image).toBe(["/images", "instructors", "teacher-legacy.jpg"].join("/"));
  });
});

