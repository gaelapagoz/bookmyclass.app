import { ProductType } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getMaxProductImageBytes as resolveMaxProductImageBytes } from "@/lib/media/product-image-config";
import {
  CanonicalMediaError,
  storeCanonicalImageWithPathPersistence,
  validateCanonicalImageFile,
} from "@/lib/media/media-upload-service";

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
  mimeType: string;
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

export async function validateProductImageUpload(file: File | null | undefined): Promise<ValidatedImageUpload | null> {
  if (!file || file.size === 0) {
    return null;
  }

  const validated = await validateCanonicalImageFile(file, { maxBytes: getMaxProductImageBytes() }).catch((error) => {
    throw mapCanonicalMediaError(error);
  });

  return {
    buffer: validated.buffer,
    extension: validated.extension,
    mimeType: validated.mimeType,
    originalFilename: validated.originalFilename,
    sizeBytes: file.size,
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

  const stored = await storeCanonicalImageWithPathPersistence({
    file: input.file,
    folder: "products",
    filenamePrefix: "product",
    maxBytes: getMaxProductImageBytes(),
    persistPath: async (publicPath, storedImage) => {
      await prisma.$transaction(async (tx) => {
      const asset = await tx.mediaAsset.create({
        data: {
          path: publicPath,
          mimeType: storedImage.mimeType,
          sizeBytes: storedImage.sizeBytes,
          originalFilename: storedImage.originalFilename,
          storageFilename: storedImage.storageFilename,
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
    },
  }).catch((error) => {
    throw mapCanonicalMediaError(error);
  });

  const mediaAsset = await prisma.mediaAsset.findUniqueOrThrow({
    where: { path: stored.publicPath },
    select: {
      id: true,
      path: true,
      mimeType: true,
      sizeBytes: true,
      originalFilename: true,
    },
  });

  return {
    id: mediaAsset.id,
    path: mediaAsset.path,
    mimeType: mediaAsset.mimeType,
    sizeBytes: mediaAsset.sizeBytes,
    originalFilename: mediaAsset.originalFilename,
  };
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

function getMaxProductImageBytes(): number {
  return resolveMaxProductImageBytes(process.env);
}

function mapCanonicalMediaError(error: unknown): ProductMediaError {
  if (!(error instanceof CanonicalMediaError)) {
    return error instanceof ProductMediaError
      ? error
      : new ProductMediaError("UNSAFE_STORAGE_PATH", error instanceof Error ? error.message : "Image upload failed.");
  }

  if (error.code === "FILE_TOO_LARGE") {
    return new ProductMediaError("IMAGE_TOO_LARGE", error.message);
  }
  if (error.code === "INVALID_MIME_TYPE") {
    return new ProductMediaError("UNSUPPORTED_MIME_TYPE", error.message);
  }
  if (error.code === "INVALID_EXTENSION") {
    return new ProductMediaError("UNSUPPORTED_EXTENSION", error.message);
  }
  if (error.code === "UNSAFE_FILENAME") {
    return new ProductMediaError("UNSAFE_FILENAME", error.message);
  }
  if (error.code === "INVALID_MAGIC_BYTES") {
    return new ProductMediaError("SIGNATURE_MISMATCH", error.message);
  }
  if (error.code === "INVALID_MEDIA_PATH" || error.code === "INVALID_MEDIA_FOLDER" || error.code === "UNSAFE_STORAGE_PATH") {
    return new ProductMediaError("UNSAFE_STORAGE_PATH", error.message);
  }
  return new ProductMediaError("IMAGE_REQUIRED", error.message);
}
