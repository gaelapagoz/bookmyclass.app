import { access } from "node:fs/promises";
import path from "node:path";

import {
  CANONICAL_MEDIA_FOLDERS,
  type CanonicalMediaFolder,
  assertCanonicalMediaFolder,
} from "@/lib/media/media-upload-service";
import { resolveUploadsConfig, assertContainedPath } from "@/lib/media/upload-config";

export type MediaRenderState = {
  readonly src: string | null;
  readonly shouldRenderFallback: boolean;
};

type MediaAccessFileSystem = {
  readonly access: typeof access;
};

export function assertCanonicalMediaPublicPath(
  publicPath: string,
  allowedFolders: readonly CanonicalMediaFolder[] = CANONICAL_MEDIA_FOLDERS,
): string {
  const normalized = normalizeRootRelativePath(publicPath);
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

  toCanonicalMediaAbsolutePath(normalized);
  return normalized;
}

export async function getCanonicalMediaRenderState(
  publicPath: string | null | undefined,
  options: {
    readonly allowedFolders?: readonly CanonicalMediaFolder[];
    readonly fileSystem?: MediaAccessFileSystem;
  } = {},
): Promise<MediaRenderState> {
  if (!publicPath) {
    return { src: null, shouldRenderFallback: true };
  }

  let normalized: string;
  try {
    normalized = assertCanonicalMediaPublicPath(publicPath, options.allowedFolders);
  } catch {
    return { src: null, shouldRenderFallback: true };
  }

  try {
    await (options.fileSystem?.access ?? access)(toCanonicalMediaAbsolutePath(normalized));
    return { src: normalized, shouldRenderFallback: false };
  } catch {
    return { src: null, shouldRenderFallback: true };
  }
}

export function toCanonicalMediaAbsolutePath(publicPath: string): string {
  const normalized = normalizeRootRelativePath(publicPath);
  const config = resolveUploadsConfig();
  const basePath = config.publicUploadsBasePath;

  if (!normalized.startsWith(`${basePath}/`)) {
    throw new Error("MEDIA_PATH_OUTSIDE_UPLOADS");
  }

  const relativeUploadPath = normalized.slice(basePath.length + 1);
  const [folder] = relativeUploadPath.split("/");
  assertCanonicalMediaFolder(folder ?? "");

  const absolutePath = path.resolve(config.uploadsDir, relativeUploadPath.split("/").join(path.sep));
  assertContainedPath(config.uploadsDir, absolutePath);
  return absolutePath;
}

function normalizeRootRelativePath(value: string): string {
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
