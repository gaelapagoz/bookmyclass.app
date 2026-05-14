import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProductType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { assertContainedPath, resolveUploadsConfig } from "@/lib/media/upload-config";

const DEFAULT_MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_UPLOAD_SUBDIR = "products";

const allowedTypes = {
  "image/jpeg": new Set([".jpg", ".jpeg"]),
  "image/png": new Set([".png"]),
  "image/webp": new Set([".webp"]),
} as const;

type AllowedMimeType = keyof typeof allowedTypes;

export type MediaAssetReadModel = {
  id: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
};

type ValidatedImageUpload = {
  buffer: Buffer;
  extension: string;
  mimeType: AllowedMimeType;
  originalFilename: string;
  sizeBytes: number;
};

export class ProductMediaError extends Error {
  constructor(
    public readonly code:
      | "PRODUCT_NOT_FOUND"
      | "IMAGE_REQUIRED"
      | "IMAGE_TOO_LARGE"
      | "UNSUPPORTED_MIME_TYPE"
      | "UNSUPPORTED_EXTENSION"
      | "UNSAFE_FILENAME"
      | "MIME_EXTENSION_MISMATCH"
      | "SIGNATURE_MISMATCH"
      | "UNSAFE_STORAGE_PATH",
    message: string,
  ) {
    super(message);
  }
}

function getMaxProductImageBytes(): number {
  const raw = process.env.PRODUCT_IMAGE_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_PRODUCT_IMAGE_BYTES;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_PRODUCT_IMAGE_BYTES;
  return parsed;
}

function isAllowedMimeType(value: string): value is AllowedMimeType {
  return Object.hasOwn(allowedTypes, value);
}

function assertSafeOriginalFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    throw new ProductMediaError("UNSAFE_FILENAME", "Image filename is required.");
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    path.basename(trimmed) !== trimmed
  ) {
    throw new ProductMediaError("UNSAFE_FILENAME", "Image filename is not safe.");
  }

  return trimmed;
}

function hasValidSignature(buffer: Buffer, mimeType: AllowedMimeType): boolean {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export async function validateProductImageUpload(file: File | null | undefined): Promise<ValidatedImageUpload | null> {
  if (!file || file.size === 0) {
    return null;
  }

  if (!isAllowedMimeType(file.type)) {
    throw new ProductMediaError("UNSUPPORTED_MIME_TYPE", "Only JPEG, PNG, and WebP images are supported.");
  }

  const originalFilename = assertSafeOriginalFilename(file.name);
  const extension = path.extname(originalFilename).toLowerCase();
  if (!extension || ![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    throw new ProductMediaError("UNSUPPORTED_EXTENSION", "Unsupported image file extension.");
  }

  if (!allowedTypes[file.type].has(extension)) {
    throw new ProductMediaError("MIME_EXTENSION_MISMATCH", "Image MIME type does not match its extension.");
  }

  if (file.size > getMaxProductImageBytes()) {
    throw new ProductMediaError("IMAGE_TOO_LARGE", "Image exceeds the configured maximum size.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length !== file.size) {
    throw new ProductMediaError("IMAGE_REQUIRED", "Image upload could not be read.");
  }

  if (!hasValidSignature(buffer, file.type)) {
    throw new ProductMediaError("SIGNATURE_MISMATCH", "Image signature does not match its MIME type.");
  }

  return {
    buffer,
    extension,
    mimeType: file.type,
    originalFilename,
    sizeBytes: file.size,
  };
}

function buildStoragePath(storageFilename: string): {
  absolutePath: string;
  publicPath: string;
  productUploadDir: string;
} {
  if (storageFilename.includes("/") || storageFilename.includes("\\") || storageFilename.includes("..")) {
    throw new ProductMediaError("UNSAFE_STORAGE_PATH", "Image storage path is not safe.");
  }

  let uploadConfig: ReturnType<typeof resolveUploadsConfig>;
  try {
    uploadConfig = resolveUploadsConfig();
  } catch (error) {
    throw new ProductMediaError(
      "UNSAFE_STORAGE_PATH",
      error instanceof Error ? error.message : "Upload storage configuration is not safe.",
    );
  }

  const productUploadDir = path.resolve(uploadConfig.uploadsDir, PRODUCT_UPLOAD_SUBDIR);
  const absolutePath = path.resolve(productUploadDir, storageFilename);

  try {
    assertContainedPath(productUploadDir, absolutePath);
  } catch {
    throw new ProductMediaError("UNSAFE_STORAGE_PATH", "Image storage path is not safe.");
  }

  return {
    absolutePath,
    publicPath: `${uploadConfig.publicUploadsBasePath}/${PRODUCT_UPLOAD_SUBDIR}/${storageFilename}`,
    productUploadDir,
  };
}

export async function uploadStoreProductImage(input: {
  productId: string;
  uploadedById: string;
  file: File;
}): Promise<MediaAssetReadModel> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: { productType: true },
  });

  if (
    !product ||
    (product.productType !== ProductType.GIFT_CARD && product.productType !== ProductType.MERCHANDISE)
  ) {
    throw new ProductMediaError("PRODUCT_NOT_FOUND", "Store product not found.");
  }

  const validated = await validateProductImageUpload(input.file);
  if (!validated) {
    throw new ProductMediaError("IMAGE_REQUIRED", "Image file is required.");
  }

  const storageFilename = `${randomUUID()}${validated.extension}`;
  const { absolutePath, publicPath, productUploadDir } = buildStoragePath(storageFilename);

  await mkdir(productUploadDir, { recursive: true });
  await writeFile(absolutePath, validated.buffer, { flag: "wx" });

  try {
    const mediaAsset = await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          path: publicPath,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          originalFilename: validated.originalFilename,
          storageFilename,
          uploadedById: input.uploadedById,
        },
        select: {
          id: true,
          path: true,
          mimeType: true,
          sizeBytes: true,
          originalFilename: true,
        },
      });

      await tx.product.update({
        where: { id: input.productId },
        data: { imageAssetId: asset.id },
        select: { id: true },
      });

      return asset;
    });

    return {
      id: mediaAsset.id,
      path: mediaAsset.path,
      mimeType: mediaAsset.mimeType,
      sizeBytes: mediaAsset.sizeBytes,
      originalFilename: mediaAsset.originalFilename,
    };
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined);
    throw error;
  }
}

export async function unlinkStoreProductImage(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { productType: true },
  });

  if (
    !product ||
    (product.productType !== ProductType.GIFT_CARD && product.productType !== ProductType.MERCHANDISE)
  ) {
    throw new ProductMediaError("PRODUCT_NOT_FOUND", "Store product not found.");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { imageAssetId: null },
    select: { id: true },
  });
}
