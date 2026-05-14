import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { resolveUploadsConfig } from "../src/lib/media/upload-config";
import type { CanonicalMediaFolder } from "../src/lib/media/media-upload-service";

const prisma = new PrismaClient();

type BackfillCandidate = {
  readonly entity: "User" | "ClassType" | "LearningProgram" | "LearningCourse" | "MediaAsset";
  readonly id: string;
  readonly field: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly sourceAbsolutePath: string;
  readonly targetAbsolutePath: string;
};

const LEGACY_FOLDER_MAP = [
  { legacyPrefix: "/images/instructors/", folder: "teachers" as const },
  { legacyPrefix: "/images/classes/", folder: "classes" as const },
  { legacyPrefix: "/images/learning/", folder: "learning" as const },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const config = resolveUploadsConfig();
  const candidates = await collectCandidates(config.uploadsDir);
  const existingTargets = await filterExistingTargets(candidates);
  const missingSources = await filterMissingSources(candidates);
  const actionable = candidates.filter(
    (candidate) =>
      !existingTargets.some((existing) => sameCandidate(existing, candidate)) &&
      !missingSources.some((missing) => sameCandidate(missing, candidate)),
  );

  console.log("[media-backfill] mode", apply ? "apply" : "dry-run");
  console.log("[media-backfill] uploadsDir", config.uploadsDir);
  console.log("[media-backfill] summary", {
    candidates: candidates.length,
    alreadyCopied: existingTargets.length,
    missingSources: missingSources.length,
    toCopyAndUpdate: actionable.length,
  });

  for (const candidate of candidates) {
    const state = existingTargets.some((existing) => sameCandidate(existing, candidate))
      ? "already-copied"
      : missingSources.some((missing) => sameCandidate(missing, candidate))
        ? "missing-source"
        : "pending";
    console.log("[media-backfill] candidate", {
      state,
      entity: candidate.entity,
      id: candidate.id,
      field: candidate.field,
      fromPath: candidate.fromPath,
      toPath: candidate.toPath,
    });
  }

  if (!apply) {
    console.log("[media-backfill] dry-run only. Re-run with --apply to copy files and update DB paths.");
    return;
  }

  for (const candidate of actionable) {
    await mkdir(path.dirname(candidate.targetAbsolutePath), { recursive: true });
    await copyFile(candidate.sourceAbsolutePath, candidate.targetAbsolutePath);
    await updateCandidatePath(candidate);
    console.log("[media-backfill] applied", {
      entity: candidate.entity,
      id: candidate.id,
      field: candidate.field,
      toPath: candidate.toPath,
    });
  }
}

async function collectCandidates(uploadsDir: string): Promise<BackfillCandidate[]> {
  const [users, classTypes, programs, courses, mediaAssets] = await Promise.all([
    prisma.user.findMany({
      where: { image: { startsWith: "/images/instructors/" } },
      select: { id: true, image: true },
    }),
    prisma.classType.findMany({
      where: { imageUrl: { startsWith: "/images/classes/" } },
      select: { id: true, imageUrl: true },
    }),
    prisma.learningProgram.findMany({
      where: {
        OR: [
          { picture1: { startsWith: "/images/learning/" } },
          { picture2: { startsWith: "/images/learning/" } },
          { picture3: { startsWith: "/images/learning/" } },
        ],
      },
      select: { id: true, picture1: true, picture2: true, picture3: true },
    }),
    prisma.learningCourse.findMany({
      where: { thumbnail: { startsWith: "/images/learning/" } },
      select: { id: true, thumbnail: true },
    }),
    prisma.mediaAsset.findMany({
      where: { path: { startsWith: "/uploads/products/" } },
      select: { id: true, path: true },
    }),
  ]);

  const candidates: BackfillCandidate[] = [];

  for (const user of users) {
    if (user.image) candidates.push(buildLegacyCandidate("User", user.id, "image", user.image, uploadsDir));
  }

  for (const classType of classTypes) {
    if (classType.imageUrl) candidates.push(buildLegacyCandidate("ClassType", classType.id, "imageUrl", classType.imageUrl, uploadsDir));
  }

  for (const program of programs) {
    for (const field of ["picture1", "picture2", "picture3"] as const) {
      const value = program[field];
      if (value?.startsWith("/images/learning/")) {
        candidates.push(buildLegacyCandidate("LearningProgram", program.id, field, value, uploadsDir));
      }
    }
  }

  for (const course of courses) {
    if (course.thumbnail) candidates.push(buildLegacyCandidate("LearningCourse", course.id, "thumbnail", course.thumbnail, uploadsDir));
  }

  for (const asset of mediaAssets) {
    candidates.push(buildUploadsCandidate("MediaAsset", asset.id, "path", asset.path, uploadsDir));
  }

  return candidates;
}

function buildLegacyCandidate(
  entity: BackfillCandidate["entity"],
  id: string,
  field: string,
  fromPath: string,
  uploadsDir: string,
): BackfillCandidate {
  const mapping = LEGACY_FOLDER_MAP.find((item) => fromPath.startsWith(item.legacyPrefix));
  if (!mapping) {
    throw new Error(`Unsupported legacy path: ${fromPath}`);
  }

  const filename = assertSafeBasename(fromPath.slice(mapping.legacyPrefix.length));
  const toPath = `/uploads/${mapping.folder}/${filename}`;
  return {
    entity,
    id,
    field,
    fromPath,
    toPath,
    sourceAbsolutePath: path.resolve(process.cwd(), "public", fromPath.replace(/^\/+/, "")),
    targetAbsolutePath: path.resolve(uploadsDir, mapping.folder, filename),
  };
}

function buildUploadsCandidate(
  entity: BackfillCandidate["entity"],
  id: string,
  field: string,
  fromPath: string,
  uploadsDir: string,
): BackfillCandidate {
  const [, folder, filename] = /^\/uploads\/([^/]+)\/([^/]+)$/.exec(fromPath) ?? [];
  if (!folder || !filename) {
    throw new Error(`Unsupported upload path: ${fromPath}`);
  }

  const safeFolder = folder as CanonicalMediaFolder;
  const safeFilename = assertSafeBasename(filename);
  return {
    entity,
    id,
    field,
    fromPath,
    toPath: fromPath,
    sourceAbsolutePath: path.resolve(process.cwd(), "public", "uploads", safeFolder, safeFilename),
    targetAbsolutePath: path.resolve(uploadsDir, safeFolder, safeFilename),
  };
}

async function updateCandidatePath(candidate: BackfillCandidate): Promise<void> {
  if (candidate.fromPath === candidate.toPath) {
    return;
  }

  if (candidate.entity === "User") {
    await prisma.user.update({ where: { id: candidate.id }, data: { image: candidate.toPath } });
    return;
  }
  if (candidate.entity === "ClassType") {
    await prisma.classType.update({ where: { id: candidate.id }, data: { imageUrl: candidate.toPath } });
    return;
  }
  if (candidate.entity === "LearningProgram") {
    await prisma.learningProgram.update({
      where: { id: candidate.id },
      data: { [candidate.field]: candidate.toPath },
    });
    return;
  }
  if (candidate.entity === "LearningCourse") {
    await prisma.learningCourse.update({ where: { id: candidate.id }, data: { thumbnail: candidate.toPath } });
  }
}

async function filterExistingTargets(candidates: readonly BackfillCandidate[]): Promise<BackfillCandidate[]> {
  const existing: BackfillCandidate[] = [];
  for (const candidate of candidates) {
    if (await exists(candidate.targetAbsolutePath)) {
      existing.push(candidate);
    }
  }
  return existing;
}

async function filterMissingSources(candidates: readonly BackfillCandidate[]): Promise<BackfillCandidate[]> {
  const missing: BackfillCandidate[] = [];
  for (const candidate of candidates) {
    if (!(await exists(candidate.sourceAbsolutePath)) && !(await exists(candidate.targetAbsolutePath))) {
      missing.push(candidate);
    }
  }
  return missing;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function assertSafeBasename(filename: string): string {
  const basename = path.basename(filename);
  if (!basename || basename !== filename || basename.includes("..") || basename.includes("/") || basename.includes("\\")) {
    throw new Error(`Unsafe media filename: ${filename}`);
  }
  return basename;
}

function sameCandidate(left: BackfillCandidate, right: BackfillCandidate): boolean {
  return left.entity === right.entity && left.id === right.id && left.field === right.field && left.fromPath === right.fromPath;
}

main()
  .catch((error) => {
    console.error("[media-backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
