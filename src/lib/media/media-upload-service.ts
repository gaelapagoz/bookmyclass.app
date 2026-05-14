import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertContainedPath, resolveUploadsConfig } from "@/lib/media/upload-config";

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const CANONICAL_MEDIA_FOLDERS = ["teachers", "classes", "learning", "products"] as const;

export type CanonicalMediaFolder = (typeof CANONICAL_MEDIA_FOLDERS)[number];

const IMAGE_TYPES = {
  "image/jpeg": {
    extensions: new Set([".jpg", ".jpeg"]),
    canonicalExtension: ".jpg",
    matchesMagicBytes: (bytes: Uint8Array) =>
      bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
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

export type CanonicalImageMimeType = keyof typeof IMAGE_TYPES;

export type CanonicalMediaErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "INVALID_MIME_TYPE"
  | "INVALID_EXTENSION"
  | "INVALID_MAGIC_BYTES"
  | "INVALID_MEDIA_FOLDER"
  | "INVALID_MEDIA_PATH"
  | "UNSAFE_FILENAME"
  | "UNSAFE_STORAGE_PATH";

export class CanonicalMediaError extends Error {
  constructor(
    public readonly code: CanonicalMediaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CanonicalMediaError";
  }
}

export type CanonicalMediaFile = Pick<File, "arrayBuffer" | "name" | "size" | "type">;

export type ValidatedCanonicalImage = {
  readonly buffer: Buffer;
  readonly extension: string;
  readonly mimeType: CanonicalImageMimeType;
  readonly originalFilename: string;
  readonly sizeBytes: number;
};

export type StoredCanonicalImage = ValidatedCanonicalImage & {
  readonly absolutePath: string;
  readonly publicPath: string;
  readonly storageFilename: string;
};

export type StoreCanonicalImageOptions = {
  readonly file: CanonicalMediaFile;
  readonly folder: CanonicalMediaFolder;
  readonly filenamePrefix: string;
  readonly maxBytes?: number;
  readonly persistPath?: (publicPath: string, stored: StoredCanonicalImage) => Promise<void>;
};

export function isCanonicalMediaFolder(value: string): value is CanonicalMediaFolder {
  return (CANONICAL_MEDIA_FOLDERS as readonly string[]).includes(value);
}

export function assertCanonicalMediaFolder(value: string): CanonicalMediaFolder {
  if (!isCanonicalMediaFolder(value)) {
    throw new CanonicalMediaError("INVALID_MEDIA_FOLDER", "Media folder is not allowed.");
  }
  return value;
}

export function assertSafeOriginalFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new CanonicalMediaError("UNSAFE_FILENAME", "Image filename is required.");
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    path.basename(trimmed) !== trimmed
  ) {
    throw new CanonicalMediaError("UNSAFE_FILENAME", "Image filename is not safe.");
  }

  return trimmed;
}

export async function validateCanonicalImageFile(
  file: CanonicalMediaFile,
  options: { readonly maxBytes?: number } = {},
): Promise<ValidatedCanonicalImage> {
  if (file.size <= 0) {
    throw new CanonicalMediaError("EMPTY_FILE", "File is empty.");
  }

  const maxBytes = options.maxBytes ?? getMaxImageBytes();
  if (file.size > maxBytes) {
    throw new CanonicalMediaError("FILE_TOO_LARGE", "File exceeds the allowed size.");
  }

  const mimeType = file.type as CanonicalImageMimeType;
  const imageType = IMAGE_TYPES[mimeType];
  if (!imageType) {
    throw new CanonicalMediaError("INVALID_MIME_TYPE", "Unsupported image MIME type.");
  }

  const originalFilename = assertSafeOriginalFilename(file.name);
  const extension = path.extname(originalFilename).toLowerCase();
  if (!imageType.extensions.has(extension)) {
    throw new CanonicalMediaError("INVALID_EXTENSION", "Image extension does not match the MIME type.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length !== file.size || !imageType.matchesMagicBytes(buffer)) {
    throw new CanonicalMediaError("INVALID_MAGIC_BYTES", "Image contents do not match the declared MIME type.");
  }

  return {
    buffer,
    extension: imageType.canonicalExtension,
    mimeType,
    originalFilename,
    sizeBytes: file.size,
  };
}

export function buildCanonicalMediaFilename(input: {
  readonly prefix: string;
  readonly extension: string;
}): string {
  const safePrefix = input.prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return `${safePrefix || "media"}-${Date.now()}-${randomUUID()}${input.extension}`;
}

export function buildCanonicalMediaStoragePath(input: {
  readonly folder: CanonicalMediaFolder;
  readonly storageFilename: string;
}): { readonly absolutePath: string; readonly folderDir: string; readonly publicPath: string } {
  const folder = assertCanonicalMediaFolder(input.folder);
  const storageFilename = assertSafeStorageFilename(input.storageFilename);
  const config = resolveUploadsConfig();
  const folderDir = path.resolve(config.uploadsDir, folder);
  const absolutePath = path.resolve(folderDir, storageFilename);

  try {
    assertContainedPath(folderDir, absolutePath);
  } catch {
    throw new CanonicalMediaError("UNSAFE_STORAGE_PATH", "Image storage path is not safe.");
  }

  return {
    absolutePath,
    folderDir,
    publicPath: `${config.publicUploadsBasePath}/${folder}/${storageFilename}`,
  };
}

export async function storeCanonicalImageWithPathPersistence(
  options: StoreCanonicalImageOptions,
): Promise<StoredCanonicalImage> {
  const folder = assertCanonicalMediaFolder(options.folder);
  const validated = await validateCanonicalImageFile(options.file, { maxBytes: options.maxBytes });
  const storageFilename = buildCanonicalMediaFilename({
    prefix: options.filenamePrefix,
    extension: validated.extension,
  });
  const { absolutePath, folderDir, publicPath } = buildCanonicalMediaStoragePath({ folder, storageFilename });
  const stored: StoredCanonicalImage = {
    ...validated,
    absolutePath,
    publicPath,
    storageFilename,
  };

  await mkdir(folderDir, { recursive: true });
  await writeFile(absolutePath, validated.buffer, { flag: "wx" });

  try {
    await options.persistPath?.(publicPath, stored);
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }

  return stored;
}

function assertSafeStorageFilename(filename: string): string {
  const trimmed = assertSafeOriginalFilename(filename);
  if (!path.extname(trimmed)) {
    throw new CanonicalMediaError("UNSAFE_STORAGE_PATH", "Image storage filename requires an extension.");
  }
  return trimmed;
}

function getMaxImageBytes(): number {
  const raw = process.env.IMAGE_UPLOAD_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_IMAGE_BYTES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_IMAGE_BYTES;
  return parsed;
}
