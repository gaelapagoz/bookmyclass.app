import { existsSync } from "node:fs";
import { access, copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { PrismaClient } from "@prisma/client";

import { resolveUploadsConfig } from "../../../src/lib/media/upload-config";

export const SEED_MEDIA_FOLDERS = ["teachers", "classes", "learning", "products"] as const;
export type SeedMediaFolder = (typeof SEED_MEDIA_FOLDERS)[number];

const LEGACY_TO_CANONICAL_PREFIX: ReadonlyArray<{
  readonly legacyPrefix: string;
  readonly canonicalPrefix: string;
}> = [
  { legacyPrefix: "/images/instructors/", canonicalPrefix: "/uploads/teachers/" },
  { legacyPrefix: "/images/classes/", canonicalPrefix: "/uploads/classes/" },
  { legacyPrefix: "/images/learning/", canonicalPrefix: "/uploads/learning/" },
];

const SOURCE_RESOLUTION_BY_FOLDER: Readonly<Record<SeedMediaFolder, readonly string[]>> = {
  teachers: ["/images/instructors/"],
  classes: ["/images/classes/"],
  learning: ["/images/learning/"],
  products: ["/uploads/products/"],
};

export type SeedMediaPlan = {
  readonly sourceAbsolutePath: string;
  readonly destinationAbsolutePath: string;
  readonly publicPath: string;
  readonly folder: SeedMediaFolder;
  readonly filename: string;
};

export type SeedMediaSyncSummary = {
  copiedCount: number;
  existingCount: number;
  verifiedCount: number;
};

export function toCanonicalSeedImagePath(inputPath: string): string {
  const normalized = normalizeRootRelativePath(inputPath);
  if (normalized.startsWith("/uploads/")) return normalized;

  for (const candidate of LEGACY_TO_CANONICAL_PREFIX) {
    if (normalized.startsWith(candidate.legacyPrefix)) {
      return `${candidate.canonicalPrefix}${normalized.slice(candidate.legacyPrefix.length)}`;
    }
  }

  return normalized;
}

export function buildStoreSeedAssetFilename(productSlug: string, extension = ".jpg"): string {
  const safeSlug = productSlug
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${safeSlug || "store-product"}${extension}`;
}

export function buildSeedMediaPlan(
  publicPathInput: string,
  options: {
    readonly sourceFolder?: SeedMediaFolder;
    readonly sourceFilename?: string;
  } = {},
): SeedMediaPlan {
  const publicPath = toCanonicalSeedImagePath(publicPathInput);
  const match = /^\/uploads\/(teachers|classes|learning|products)\/([^/]+)$/i.exec(publicPath);
  if (!match) {
    throw new Error(`Seed media path must use /uploads/<folder>/<filename>: ${publicPathInput}`);
  }

  const folder = match[1]!.toLowerCase() as SeedMediaFolder;
  const filename = match[2]!;
  const sourceCandidates = options.sourceFolder
    ? SOURCE_RESOLUTION_BY_FOLDER[options.sourceFolder]
    : SOURCE_RESOLUTION_BY_FOLDER[folder];

  const config = resolveUploadsConfig();
  const destinationAbsolutePath = path.resolve(config.uploadsDir, folder, filename);
  const sourceAbsolutePath = resolveExistingSourcePath(options.sourceFilename ?? filename, sourceCandidates);

  return {
    sourceAbsolutePath,
    destinationAbsolutePath,
    publicPath,
    folder,
    filename,
  };
}

export async function syncSeedMediaAsset(plan: SeedMediaPlan): Promise<"copied" | "existing"> {
  await mkdir(path.dirname(plan.destinationAbsolutePath), { recursive: true });
  try {
    await access(plan.destinationAbsolutePath);
    return "existing";
  } catch {
    await copyFile(plan.sourceAbsolutePath, plan.destinationAbsolutePath);
    return "copied";
  }
}

export async function syncSeedMediaPath(
  publicPathInput: string,
  options: {
    readonly sourceFolder?: SeedMediaFolder;
    readonly sourceFilename?: string;
  } = {},
): Promise<"copied" | "existing"> {
  const publicPath = toCanonicalSeedImagePath(publicPathInput);
  const match = /^\/uploads\/(teachers|classes|learning|products)\/([^/]+)$/i.exec(publicPath);
  if (!match) {
    throw new Error(`Seed media path must use /uploads/<folder>/<filename>: ${publicPathInput}`);
  }

  const folder = match[1]!.toLowerCase() as SeedMediaFolder;
  const filename = match[2]!;
  const config = resolveUploadsConfig();
  const destinationAbsolutePath = path.resolve(config.uploadsDir, folder, filename);
  await mkdir(path.dirname(destinationAbsolutePath), { recursive: true });

  try {
    await access(destinationAbsolutePath);
    return "existing";
  } catch {
    const plan = buildSeedMediaPlan(publicPath, options);
    await copyFile(plan.sourceAbsolutePath, destinationAbsolutePath);
    return "copied";
  }
}

export async function verifySeedMediaPathExists(publicPathInput: string): Promise<void> {
  const publicPath = toCanonicalSeedImagePath(publicPathInput);
  const match = /^\/uploads\/(teachers|classes|learning|products)\/([^/]+)$/i.exec(publicPath);
  if (!match) {
    throw new Error(`Seed media path must use /uploads/<folder>/<filename>: ${publicPathInput}`);
  }

  const config = resolveUploadsConfig();
  const absolutePath = path.resolve(config.uploadsDir, match[1]!.toLowerCase(), match[2]!);
  try {
    await access(absolutePath);
  } catch {
    throw new Error(`Seed media file missing: dbPath=${publicPath}, fsPath=${absolutePath}`);
  }
}

export async function verifySeededMediaReferences(prisma: PrismaClient): Promise<number> {
  const [users, classTypes, programs, courses, products] = await prisma.$transaction([
    prisma.user.findMany({
      where: { image: { startsWith: "/uploads/" } },
      select: { image: true },
    }),
    prisma.classType.findMany({
      where: { imageUrl: { startsWith: "/uploads/" } },
      select: { imageUrl: true },
    }),
    prisma.learningProgram.findMany({
      where: {
        OR: [
          { picture1: { startsWith: "/uploads/" } },
          { picture2: { startsWith: "/uploads/" } },
          { picture3: { startsWith: "/uploads/" } },
        ],
      },
      select: { picture1: true, picture2: true, picture3: true },
    }),
    prisma.learningCourse.findMany({
      where: { thumbnail: { startsWith: "/uploads/" } },
      select: { thumbnail: true },
    }),
    prisma.product.findMany({
      where: { imageAssetId: { not: null } },
      select: {
        slug: true,
        imageAssetId: true,
        imageAsset: {
          select: { path: true },
        },
      },
    }),
  ]);

  const paths = new Set<string>();
  for (const row of users) if (row.image) paths.add(row.image);
  for (const row of classTypes) if (row.imageUrl) paths.add(row.imageUrl);
  for (const row of programs) {
    if (row.picture1) paths.add(row.picture1);
    if (row.picture2) paths.add(row.picture2);
    if (row.picture3) paths.add(row.picture3);
  }
  for (const row of courses) if (row.thumbnail) paths.add(row.thumbnail);
  for (const row of products) {
    if (!row.imageAssetId || !row.imageAsset?.path) {
      throw new Error(`Seed product image relation invalid for slug=${row.slug}`);
    }
    paths.add(row.imageAsset.path);
  }

  for (const publicPath of paths) {
    await verifySeedMediaPathExists(publicPath);
  }

  return paths.size;
}

export async function readSeedFileSizeBytes(absolutePath: string): Promise<number> {
  const metadata = await stat(absolutePath);
  return metadata.size;
}

function resolveExistingSourcePath(filename: string, sourcePrefixes: readonly string[]): string {
  const tried: string[] = [];
  for (const prefix of sourcePrefixes) {
    const normalizedPrefix = normalizeRootRelativePath(prefix).replace(/\/+$/, "/");
    const absolute = path.resolve(process.cwd(), "public", normalizedPrefix.replace(/^\//, ""), filename);
    tried.push(absolute);
    if (existsSync(absolute)) {
      return absolute;
    }
    continue;
  }

  throw new Error(`Seed media source missing for ${filename}. Tried: ${tried.join(", ")}`);
}

function normalizeRootRelativePath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized.startsWith("/")) {
    throw new Error(`Path must be root-relative: ${value}`);
  }
  if (normalized.includes("..")) {
    throw new Error(`Path traversal is not allowed: ${value}`);
  }
  return path.posix.normalize(normalized);
}
