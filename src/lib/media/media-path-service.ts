import path from "node:path";

import {
  CANONICAL_MEDIA_FOLDERS,
  type CanonicalMediaFolder,
  assertCanonicalMediaFolder,
} from "@/lib/media/media-upload-service";
import { assertContainedPath, resolveUploadsConfig } from "@/lib/media/upload-config";

export function normalizeCanonicalMediaPublicPath(value: string): string {
  const rootRelativePath = value.trim().replaceAll("\\", "/");
  if (!rootRelativePath.startsWith("/") || rootRelativePath.split("/").includes("..")) {
    throw new Error("MEDIA_PATH_INVALID");
  }

  const normalized = path.posix.normalize(rootRelativePath);
  if (!normalized.startsWith("/") || normalized.includes("/../") || normalized.endsWith("/..")) {
    throw new Error("MEDIA_PATH_INVALID");
  }

  return normalized;
}

export function assertCanonicalMediaPublicPath(
  publicPath: string,
  allowedFolders: readonly CanonicalMediaFolder[] = CANONICAL_MEDIA_FOLDERS,
): string {
  const normalized = normalizeCanonicalMediaPublicPath(publicPath);
  const config = resolveUploadsConfig();
  const basePath = config.publicUploadsBasePath;

  if (!normalized.startsWith(`${basePath}/`)) {
    throw new Error("MEDIA_PATH_OUTSIDE_UPLOADS");
  }

  const [folder, ...rest] = normalized.slice(basePath.length + 1).split("/");
  assertCanonicalMediaFolder(folder ?? "");

  if (!allowedFolders.includes(folder as CanonicalMediaFolder) || rest.length === 0 || !rest.at(-1)) {
    throw new Error("MEDIA_PATH_OUTSIDE_ALLOWED_FOLDER");
  }

  return normalized;
}

export function toCanonicalMediaAbsolutePath(publicPath: string): string {
  const normalized = assertCanonicalMediaPublicPath(publicPath);
  const config = resolveUploadsConfig();
  const basePath = config.publicUploadsBasePath;
  const relativeUploadPath = normalized.slice(basePath.length + 1);
  const absolutePath = path.resolve(config.uploadsDir, relativeUploadPath.split("/").join(path.sep));

  assertContainedPath(config.uploadsDir, absolutePath);
  return absolutePath;
}

