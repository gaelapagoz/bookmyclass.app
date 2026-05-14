import "./helpers/setup-env";

import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductMediaError,
  unlinkStoreProductImage,
  uploadStoreProductImage,
  validateProductImageUpload,
} from "../../src/lib/media/product-media-service";
import { resolveUploadsConfig } from "../../src/lib/media/upload-config";
import { createAdminStoreGiftCardProduct } from "../../src/lib/store/store-admin-catalog-service";
import { listStoreCatalogReadModels } from "../../src/lib/store/store-catalog";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const writtenPublicPaths: string[] = [];
const tempUploadDirs: string[] = [];

function fileFromBytes(bytes: number[], name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function pngFile(name = "product.png"): File {
  return fileFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00], name, "image/png");
}

function jpegFile(name = "product.jpg"): File {
  return fileFromBytes([0xff, 0xd8, 0xff, 0xe0, 0x00], name, "image/jpeg");
}

function webpFile(name = "product.webp"): File {
  return fileFromBytes([0x52, 0x49, 0x46, 0x46, 0x01, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50], name, "image/webp");
}

async function createAdminUser() {
  return prisma.user.create({
    data: {
      name: "Media Admin",
      email: `media.admin.${Date.now()}@example.test`,
      role: Role.ADMIN,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });
}

async function createStoreProduct(productType = ProductType.MERCHANDISE) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const product = await prisma.product.create({
    data: {
      name: `Media Product ${stamp}`,
      slug: `media-product-${stamp}`,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });

  await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `media-product-${stamp}`,
      stripePriceId: `price_test_media_${stamp}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "Media Product",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
      isActive: true,
      isArchived: false,
    },
  });

  return product;
}

async function remember(publicPath: string) {
  writtenPublicPaths.push(publicPath);
}

function publicPathToAbsolute(publicPath: string): string {
  const uploadsBasePath = "/uploads/";
  if (!publicPath.startsWith(uploadsBasePath)) {
    throw new Error(`Unexpected public upload path: ${publicPath}`);
  }

  return path.join(resolveUploadsConfig().uploadsDir, publicPath.slice(uploadsBasePath.length));
}

describe("product media service", () => {
  beforeEach(async () => {
    await resetDb();
    writtenPublicPaths.length = 0;
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-product-media-"));
    tempUploadDirs.push(uploadsDir);
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");
  });

  afterEach(async () => {
    await Promise.all(
      writtenPublicPaths.map(async (publicPath) => {
        await unlink(publicPathToAbsolute(publicPath)).catch(() => undefined);
      }),
    );
    await Promise.all(tempUploadDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempUploadDirs.length = 0;
    vi.unstubAllEnvs();
  });

  it("creates a MediaAsset row and links it to a Store product", async () => {
    const admin = await createAdminUser();
    const product = await createStoreProduct();

    const asset = await uploadStoreProductImage({
      productId: product.id,
      uploadedById: admin.id,
      file: pngFile(),
    });
    await remember(asset.path);

    expect(asset.path).toMatch(/^\/uploads\/products\/product-\d+-[0-9a-f-]+\.png$/);
    expect(asset.mimeType).toBe("image/png");

    const storedProduct = await prisma.product.findUnique({
      where: { id: product.id },
      select: { imageAssetId: true, imageAsset: true },
    });
    expect(storedProduct!.imageAssetId).toBe(asset.id);
    expect(storedProduct!.imageAsset!.path).toBe(asset.path);
    expect(existsSync(publicPathToAbsolute(asset.path))).toBe(true);
    expect(publicPathToAbsolute(asset.path)).not.toContain(path.join(process.cwd(), "public"));
  });

  it("replaces a product image without deleting the previous MediaAsset", async () => {
    const admin = await createAdminUser();
    const product = await createStoreProduct();

    const first = await uploadStoreProductImage({ productId: product.id, uploadedById: admin.id, file: pngFile("first.png") });
    const second = await uploadStoreProductImage({ productId: product.id, uploadedById: admin.id, file: jpegFile("second.jpg") });
    await remember(first.path);
    await remember(second.path);

    const storedProduct = await prisma.product.findUnique({
      where: { id: product.id },
      select: { imageAssetId: true },
    });
    expect(storedProduct!.imageAssetId).toBe(second.id);
    expect(await prisma.mediaAsset.findUnique({ where: { id: first.id } })).not.toBeNull();
  });

  it("unlinks product image without deleting the MediaAsset row", async () => {
    const admin = await createAdminUser();
    const product = await createStoreProduct();
    const asset = await uploadStoreProductImage({ productId: product.id, uploadedById: admin.id, file: webpFile() });
    await remember(asset.path);

    await unlinkStoreProductImage(product.id);

    const storedProduct = await prisma.product.findUnique({ where: { id: product.id }, select: { imageAssetId: true } });
    expect(storedProduct!.imageAssetId).toBeNull();
    expect(await prisma.mediaAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });

  it("exposes image assets in the Store catalog read model", async () => {
    const admin = await createAdminUser();
    const product = await createStoreProduct();
    const asset = await uploadStoreProductImage({ productId: product.id, uploadedById: admin.id, file: pngFile() });
    await remember(asset.path);

    const catalog = await listStoreCatalogReadModels();
    expect(catalog.find((item) => item.id === product.id)?.imageAsset?.path).toBe(asset.path);
  });

  it("supports image upload for gift-card products", async () => {
    const admin = await createAdminUser();
    const { id } = await createAdminStoreGiftCardProduct({
      name: "Media Gift Card",
      sortOrder: 1,
      unitAmountMinor: 2500,
      isActive: true,
    });

    const asset = await uploadStoreProductImage({ productId: id, uploadedById: admin.id, file: pngFile() });
    await remember(asset.path);

    const product = await prisma.product.findUnique({ where: { id }, select: { imageAssetId: true } });
    expect(product!.imageAssetId).toBe(asset.id);
  });

  it("rejects invalid MIME, extension, SVG, traversal, oversize, and signature mismatch inputs", async () => {
    await expect(validateProductImageUpload(fileFromBytes([1, 2, 3], "bad.txt", "text/plain"))).rejects.toMatchObject({ code: "UNSUPPORTED_MIME_TYPE" });
    await expect(validateProductImageUpload(fileFromBytes([0xff, 0xd8, 0xff], "bad.gif", "image/jpeg"))).rejects.toMatchObject({ code: "UNSUPPORTED_EXTENSION" });
    await expect(validateProductImageUpload(fileFromBytes([60, 115, 118, 103], "bad.svg", "image/svg+xml"))).rejects.toMatchObject({ code: "UNSUPPORTED_MIME_TYPE" });
    await expect(validateProductImageUpload(pngFile("../bad.png"))).rejects.toMatchObject({ code: "UNSAFE_FILENAME" });
    await expect(validateProductImageUpload(fileFromBytes([0x89, 0x50, 0x4e], "bad.png", "image/png"))).rejects.toMatchObject({ code: "SIGNATURE_MISMATCH" });
    await expect(validateProductImageUpload(fileFromBytes([0xff, 0xd8, 0xff], "bad.png", "image/jpeg"))).rejects.toMatchObject({ code: "UNSUPPORTED_EXTENSION" });

    vi.stubEnv("PRODUCT_IMAGE_MAX_BYTES", "8");
    await expect(validateProductImageUpload(pngFile("too-large.png"))).rejects.toMatchObject({ code: "IMAGE_TOO_LARGE" });
  });

  it("rejects non-Store products for the Store image workflow", async () => {
    const admin = await createAdminUser();
    const product = await createStoreProduct(ProductType.CLASS_PACK);

    await expect(
      uploadStoreProductImage({ productId: product.id, uploadedById: admin.id, file: pngFile() }),
    ).rejects.toBeInstanceOf(ProductMediaError);
  });
});
