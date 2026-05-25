import { access, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { assertCanonicalMediaFolder, type CanonicalMediaFolder } from "@/lib/media/media-upload-service";
import { resolveUploadsConfig } from "@/lib/media/upload-config";

type BackfillEntity = "User" | "ClassType" | "LearningProgram" | "LearningCourse" | "MediaAsset";

export type BackfillCandidate = {
  readonly entity: BackfillEntity;
  readonly id: string;
  readonly field: string;
  readonly fromPath: string;
  readonly toPath: string;
  readonly sourceAbsolutePath: string;
  readonly targetAbsolutePath: string;
};

export type MediaBackfillRunOptions = {
  readonly prisma: PrismaClient;
  readonly apply: boolean;
  readonly uploadsDir?: string;
  readonly legacyPublicDir?: string;
};

export type MediaBackfillRunResult = {
  readonly mode: "dry-run" | "apply";
  readonly uploadsDir: string;
  readonly summary: {
    readonly candidates: number;
    readonly alreadyCopied: number;
    readonly missingSources: number;
    readonly toCopyAndUpdate: number;
    readonly applied: number;
  };
  readonly candidates: readonly BackfillCandidate[];
  readonly existingTargets: readonly BackfillCandidate[];
  readonly missingSources: readonly BackfillCandidate[];
  readonly actionable: readonly BackfillCandidate[];
  readonly dbUpdateOnly: readonly BackfillCandidate[];
  readonly applied: readonly BackfillCandidate[];
};

const LEGACY_IMAGES_ROOT = ["/images"].join("");
const LEGACY_INSTRUCTORS_PREFIX = `${LEGACY_IMAGES_ROOT}/instructors/`;
const LEGACY_CLASSES_PREFIX = `${LEGACY_IMAGES_ROOT}/classes/`;
const LEGACY_LEARNING_PREFIX = `${LEGACY_IMAGES_ROOT}/learning/`;

const LEGACY_FOLDER_MAP = [
  { legacyPrefix: LEGACY_INSTRUCTORS_PREFIX, folder: "teachers" as const },
  { legacyPrefix: LEGACY_CLASSES_PREFIX, folder: "classes" as const },
  { legacyPrefix: LEGACY_LEARNING_PREFIX, folder: "learning" as const },
];

export async function runMediaBackfill(options: MediaBackfillRunOptions): Promise<MediaBackfillRunResult> {
  const config = resolveUploadsConfig();
  const uploadsDir = options.uploadsDir ?? config.uploadsDir;
  const legacyPublicDir = options.legacyPublicDir ?? path.resolve(process.cwd(), "public");
  const candidates = await collectCandidates(options.prisma, uploadsDir, legacyPublicDir);
  const existingTargets = await filterExistingTargets(candidates);
  const missingSources = await filterMissingSources(candidates);
  const missingSourceSet = new Set(missingSources.map((candidate) => candidateKey(candidate)));
  const existingTargetSet = new Set(existingTargets.map((candidate) => candidateKey(candidate)));
  const actionable = candidates.filter(
    (candidate) => !missingSourceSet.has(candidateKey(candidate)) && !existingTargetSet.has(candidateKey(candidate)),
  );
  const dbUpdateOnly = candidates.filter(
    (candidate) =>
      !missingSourceSet.has(candidateKey(candidate)) &&
      existingTargetSet.has(candidateKey(candidate)) &&
      candidate.fromPath !== candidate.toPath,
  );

  const applied: BackfillCandidate[] = [];
  if (options.apply) {
    for (const candidate of actionable) {
      if (!existingTargetSet.has(candidateKey(candidate))) {
        await mkdir(path.dirname(candidate.targetAbsolutePath), { recursive: true });
        await copyFile(candidate.sourceAbsolutePath, candidate.targetAbsolutePath);
      }
      await updateCandidatePath(options.prisma, candidate);
      applied.push(candidate);
    }

    for (const candidate of dbUpdateOnly) {
      await updateCandidatePath(options.prisma, candidate);
      applied.push(candidate);
    }
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    uploadsDir,
    summary: {
      candidates: candidates.length,
      alreadyCopied: existingTargets.length,
      missingSources: missingSources.length,
      toCopyAndUpdate: actionable.length,
      applied: applied.length,
    },
    candidates,
    existingTargets,
    missingSources,
    actionable,
    dbUpdateOnly,
    applied,
  };
}

async function collectCandidates(
  prisma: PrismaClient,
  uploadsDir: string,
  legacyPublicDir: string,
): Promise<BackfillCandidate[]> {
  const [users, classTypes, programs, courses, mediaAssets] = await Promise.all([
    prisma.user.findMany({
      where: { image: { startsWith: LEGACY_INSTRUCTORS_PREFIX } },
      select: { id: true, image: true },
    }),
    prisma.classType.findMany({
      where: { imageUrl: { startsWith: LEGACY_CLASSES_PREFIX } },
      select: { id: true, imageUrl: true },
    }),
    prisma.learningProgram.findMany({
      where: {
        OR: [
          { picture1: { startsWith: LEGACY_LEARNING_PREFIX } },
          { picture2: { startsWith: LEGACY_LEARNING_PREFIX } },
          { picture3: { startsWith: LEGACY_LEARNING_PREFIX } },
        ],
      },
      select: { id: true, picture1: true, picture2: true, picture3: true },
    }),
    prisma.learningCourse.findMany({
      where: { thumbnail: { startsWith: LEGACY_LEARNING_PREFIX } },
      select: { id: true, thumbnail: true },
    }),
    prisma.mediaAsset.findMany({
      where: { path: { startsWith: "/uploads/products/" } },
      select: { id: true, path: true },
    }),
  ]);

  const candidates: BackfillCandidate[] = [];

  for (const user of users) {
    if (user.image) candidates.push(buildLegacyCandidate("User", user.id, "image", user.image, uploadsDir, legacyPublicDir));
  }

  for (const classType of classTypes) {
    if (classType.imageUrl) {
      candidates.push(buildLegacyCandidate("ClassType", classType.id, "imageUrl", classType.imageUrl, uploadsDir, legacyPublicDir));
    }
  }

  for (const program of programs) {
    for (const field of ["picture1", "picture2", "picture3"] as const) {
      const value = program[field];
      if (value?.startsWith(LEGACY_LEARNING_PREFIX)) {
        candidates.push(buildLegacyCandidate("LearningProgram", program.id, field, value, uploadsDir, legacyPublicDir));
      }
    }
  }

  for (const course of courses) {
    if (course.thumbnail) {
      candidates.push(buildLegacyCandidate("LearningCourse", course.id, "thumbnail", course.thumbnail, uploadsDir, legacyPublicDir));
    }
  }

  for (const asset of mediaAssets) {
    candidates.push(buildUploadsCandidate("MediaAsset", asset.id, "path", asset.path, uploadsDir, legacyPublicDir));
  }

  return candidates;
}

function buildLegacyCandidate(
  entity: BackfillEntity,
  id: string,
  field: string,
  fromPath: string,
  uploadsDir: string,
  legacyPublicDir: string,
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
    sourceAbsolutePath: path.resolve(legacyPublicDir, fromPath.replace(/^\/+/, "")),
    targetAbsolutePath: path.resolve(uploadsDir, mapping.folder, filename),
  };
}

function buildUploadsCandidate(
  entity: BackfillEntity,
  id: string,
  field: string,
  fromPath: string,
  uploadsDir: string,
  legacyPublicDir: string,
): BackfillCandidate {
  const [, folder, filename] = /^\/uploads\/([^/]+)\/([^/]+)$/.exec(fromPath) ?? [];
  if (!folder || !filename) {
    throw new Error(`Unsupported upload path: ${fromPath}`);
  }

  const safeFolder = assertCanonicalMediaFolder(folder) as CanonicalMediaFolder;
  const safeFilename = assertSafeBasename(filename);
  return {
    entity,
    id,
    field,
    fromPath,
    toPath: fromPath,
    sourceAbsolutePath: path.resolve(legacyPublicDir, "uploads", safeFolder, safeFilename),
    targetAbsolutePath: path.resolve(uploadsDir, safeFolder, safeFilename),
  };
}

async function updateCandidatePath(prisma: PrismaClient, candidate: BackfillCandidate): Promise<void> {
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

function candidateKey(candidate: BackfillCandidate): string {
  return `${candidate.entity}:${candidate.id}:${candidate.field}:${candidate.fromPath}`;
}
