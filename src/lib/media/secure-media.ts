import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, posix, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PUBLIC_ROOT = resolve(process.cwd(), "public");

const IMAGE_TYPES = {
  "image/jpeg": {
    extensions: new Set([".jpg", ".jpeg"]),
    canonicalExtension: ".jpg",
    matchesMagicBytes: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  },
  "image/png": {
    extensions: new Set([".png"]),
    canonicalExtension: ".png",
    matchesMagicBytes: (bytes: Uint8Array) =>
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a,
  },
  "image/webp": {
    extensions: new Set([".webp"]),
    canonicalExtension: ".webp",
    matchesMagicBytes: (bytes: Uint8Array) =>
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50,
  },
} as const;

export type SecureImageMimeType = keyof typeof IMAGE_TYPES;

export const DEFAULT_ALLOWED_MEDIA_FOLDERS = [
  "/uploads/classes",
  "/uploads/teachers",
  "/uploads/learning",
  "/uploads/marketing",
] as const;

export type SecureMediaErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_MIME_TYPE"
  | "INVALID_EXTENSION"
  | "INVALID_MAGIC_BYTES"
  | "INVALID_MEDIA_FOLDER"
  | "INVALID_MEDIA_PATH";

export class SecureMediaError extends Error {
  constructor(
    public readonly code: SecureMediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SecureMediaError";
  }
}

export type SecureMediaFile = Pick<File, "arrayBuffer" | "name" | "size" | "type">;

export interface SecureMediaValidationOptions {
  readonly allowedMimeTypes?: readonly SecureImageMimeType[];
  readonly maxBytes?: number;
}

export interface StoreSecureMediaOptions extends SecureMediaValidationOptions {
  readonly file: SecureMediaFile;
  readonly folder: string;
  readonly filenamePrefix: string;
  readonly allowedFolders?: readonly string[];
  readonly persistPath: (publicPath: string) => Promise<void>;
  readonly fileSystem?: SecureMediaFileSystem;
}

export interface SecureMediaFileSystem {
  readonly mkdir: typeof mkdir;
  readonly writeFile: typeof writeFile;
  readonly unlink: typeof unlink;
  readonly access: typeof access;
}

export interface StoredSecureMedia {
  readonly absolutePath: string;
  readonly publicPath: string;
  readonly bytes: Buffer;
  readonly mimeType: SecureImageMimeType;
}

export interface MediaRenderState {
  readonly src: string | null;
  readonly shouldRenderFallback: boolean;
}

const defaultFileSystem: SecureMediaFileSystem = {
  mkdir,
  writeFile,
  unlink,
  access,
};

export async function validateSecureImageFile(
  file: SecureMediaFile,
  options: SecureMediaValidationOptions = {},
): Promise<{ readonly bytes: Buffer; readonly extension: string; readonly mimeType: SecureImageMimeType }> {
  if (file.size <= 0) {
    throw new SecureMediaError("EMPTY_FILE", "File is empty.");
  }

  const maxBytes = options.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    throw new SecureMediaError("FILE_TOO_LARGE", "File exceeds the allowed size.");
  }

  const allowedMimeTypes = options.allowedMimeTypes ?? (Object.keys(IMAGE_TYPES) as SecureImageMimeType[]);
  const mimeType = file.type as SecureImageMimeType;
  if (!allowedMimeTypes.includes(mimeType) || !IMAGE_TYPES[mimeType]) {
    throw new SecureMediaError("INVALID_MIME_TYPE", "Unsupported image MIME type.");
  }

  const extension = extname(file.name).toLowerCase();
  const imageType = IMAGE_TYPES[mimeType];
  if (!imageType.extensions.has(extension)) {
    throw new SecureMediaError("INVALID_EXTENSION", "Image extension does not match the MIME type.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || !imageType.matchesMagicBytes(bytes)) {
    throw new SecureMediaError("INVALID_MAGIC_BYTES", "Image contents do not match the declared MIME type.");
  }

  return {
    bytes,
    extension: imageType.canonicalExtension,
    mimeType,
  };
}

export function normalizeAllowedMediaFolder(
  folder: string,
  allowedFolders: readonly string[] = DEFAULT_ALLOWED_MEDIA_FOLDERS,
): string {
  const normalized = normalizePublicPath(folder);
  const allowed = new Set(allowedFolders.map((allowedFolder) => normalizePublicPath(allowedFolder)));

  if (!allowed.has(normalized)) {
    throw new SecureMediaError("INVALID_MEDIA_FOLDER", "Media folder is not allowed.");
  }

  return normalized;
}

export function assertSafeMediaPublicPath(
  publicPath: string,
  allowedFolders: readonly string[] = DEFAULT_ALLOWED_MEDIA_FOLDERS,
): string {
  const normalized = normalizePublicPath(publicPath);
  const allowedFolder = allowedFolders
    .map((folder) => normalizePublicPath(folder))
    .find((folder) => normalized === folder || normalized.startsWith(`${folder}/`));

  if (!allowedFolder || normalized === allowedFolder) {
    throw new SecureMediaError("INVALID_MEDIA_PATH", "Media path is outside allowed folders.");
  }

  toContainedPublicAbsolutePath(normalized);
  return normalized;
}

export function buildSafeMediaFilename(input: { readonly prefix: string; readonly extension: string }): string {
  const safePrefix = input.prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return `${safePrefix || "media"}-${Date.now()}-${randomUUID()}${input.extension}`;
}

export async function storeSecureImageWithPathPersistence(options: StoreSecureMediaOptions): Promise<StoredSecureMedia> {
  const folder = normalizeAllowedMediaFolder(options.folder, options.allowedFolders);
  const validated = await validateSecureImageFile(options.file, options);
  const fileName = buildSafeMediaFilename({
    prefix: options.filenamePrefix,
    extension: validated.extension,
  });
  const publicPath = assertSafeMediaPublicPath(posix.join(folder, fileName), options.allowedFolders);
  const absolutePath = toContainedPublicAbsolutePath(publicPath);
  const fileSystem = options.fileSystem ?? defaultFileSystem;

  await fileSystem.mkdir(dirname(absolutePath), { recursive: true });
  await fileSystem.writeFile(absolutePath, validated.bytes);

  try {
    await options.persistPath(publicPath);
  } catch (error) {
    try {
      await fileSystem.unlink(absolutePath);
    } catch {
      // Best effort cleanup only; preserve the persistence failure for callers.
    }

    throw error;
  }

  return {
    absolutePath,
    publicPath,
    bytes: validated.bytes,
    mimeType: validated.mimeType,
  };
}

export async function getLocalMediaRenderState(
  publicPath: string | null | undefined,
  options: {
    readonly allowedFolders?: readonly string[];
    readonly fileSystem?: Pick<SecureMediaFileSystem, "access">;
  } = {},
): Promise<MediaRenderState> {
  if (!publicPath) {
    return { src: null, shouldRenderFallback: true };
  }

  let normalized: string;
  try {
    normalized = assertSafeMediaPublicPath(publicPath, options.allowedFolders);
  } catch {
    return { src: null, shouldRenderFallback: true };
  }

  try {
    await (options.fileSystem ?? defaultFileSystem).access(toContainedPublicAbsolutePath(normalized));
    return { src: normalized, shouldRenderFallback: false };
  } catch {
    return { src: null, shouldRenderFallback: true };
  }
}

function normalizePublicPath(value: string): string {
  const rootRelativePath = value.trim().replaceAll("\\", "/");
  if (!rootRelativePath.startsWith("/")) {
    throw new SecureMediaError("INVALID_MEDIA_PATH", "Media path must be root-relative.");
  }

  if (rootRelativePath.split("/").includes("..")) {
    throw new SecureMediaError("INVALID_MEDIA_PATH", "Media path must not contain traversal.");
  }

  const normalized = posix.normalize(rootRelativePath);
  if (!normalized.startsWith("/") || normalized.includes("/../") || normalized.endsWith("/..")) {
    throw new SecureMediaError("INVALID_MEDIA_PATH", "Media path must not contain traversal.");
  }

  return normalized;
}

function toContainedPublicAbsolutePath(publicPath: string): string {
  const relativePath = publicPath.replace(/^\/+/, "").split("/").join(sep);
  const absolutePath = resolve(PUBLIC_ROOT, relativePath);

  if (absolutePath !== PUBLIC_ROOT && absolutePath.startsWith(`${PUBLIC_ROOT}${sep}`)) {
    return absolutePath;
  }

  throw new SecureMediaError("INVALID_MEDIA_PATH", "Media path escapes public directory.");
}
