import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  STORE_CATALOG_PRODUCTS,
} from "../../prisma/seed/data/store-catalog";
import {
  buildSeedMediaPlan,
  buildStoreSeedAssetFilename,
  syncSeedMediaAsset,
  toCanonicalSeedImagePath,
  verifySeedMediaPathExists,
} from "../../prisma/seed/utils/seed-media";

describe("seed media utils", () => {
  beforeEach(async () => {
    const uploadsRoot = await mkdtemp(path.join(os.tmpdir(), "seed-media-uploads-"));
    process.env.NODE_ENV = "test";
    process.env.UPLOADS_DIR = uploadsRoot;
    process.env.PUBLIC_UPLOADS_BASE_PATH = "/uploads";
    process.env.BOOKMYCLASS_SEED_MODE = "development";
  });

  it("accepts canonical uploads paths and rejects legacy seed paths", () => {
    const legacyTeachersPath = ["/images", "instructors", "ana.jpg"].join("/");
    const legacyClassesPath = ["/images", "classes", "vinyasa.jpg"].join("/");
    const legacyLearningPath = ["/images", "learning", "course.jpg"].join("/");

    expect(() => toCanonicalSeedImagePath(legacyTeachersPath)).toThrow(/must use \/uploads/);
    expect(() => toCanonicalSeedImagePath(legacyClassesPath)).toThrow(/must use \/uploads/);
    expect(() => toCanonicalSeedImagePath(legacyLearningPath)).toThrow(/must use \/uploads/);
    expect(toCanonicalSeedImagePath("/uploads/products/item.jpg")).toBe("/uploads/products/item.jpg");
  });

  it("builds deterministic store filenames from product slug", () => {
    expect(buildStoreSeedAssetFilename("store-gift-card-25-eur")).toBe("store-gift-card-25-eur.jpg");
    expect(buildStoreSeedAssetFilename("Store Merch Yoga Mat")).toBe("store-merch-yoga-mat.jpg");
  });

  it("keeps explicit product seed-image filename mapping contract", () => {
    const mapping = new Map(STORE_CATALOG_PRODUCTS.map((product) => [product.slug, product.seedImageSourceFilename]));
    expect(mapping.get("store-gift-card-25-eur")).toBe("giftcard25.jpg");
    expect(mapping.get("store-gift-card-50-eur")).toBe("giftcard50.jpg");
    expect(mapping.get("store-gift-card-100-eur")).toBe("giftcard100.jpg");
    expect(mapping.get("store-merch-yoga-mat")).toBe("product_mat.jpg");
    expect(mapping.get("store-merch-resistance-bands")).toBe("product_band.jpg");
    expect(mapping.get("store-merch-studio-tote")).toBe("product_bag.jpg");
  });

  it("copies canonical seed media to UPLOADS_DIR and is idempotent", async () => {
    const sourceDir = path.resolve(process.cwd(), "prisma", "seed-data", "dev-images", "teachers");
    await mkdir(sourceDir, { recursive: true });
    const sourceAbsolute = path.join(sourceDir, "seed-teacher.jpg");
    await writeFile(sourceAbsolute, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const plan = buildSeedMediaPlan("/uploads/teachers/seed-teacher.jpg");
    expect(plan.sourceAbsolutePath).toBe(sourceAbsolute);

    const first = await syncSeedMediaAsset(plan);
    const second = await syncSeedMediaAsset(plan);
    expect(first).toBe("copied");
    expect(second).toBe("existing");

    await verifySeedMediaPathExists("/uploads/teachers/seed-teacher.jpg");
    await rm(sourceAbsolute, { force: true });
  });

  it("fails with mode-based source path diagnostics when source file is missing", () => {
    expect(() => buildSeedMediaPlan("/uploads/teachers/missing-seed-teacher.jpg")).toThrow(
      /mode=development, folder=teachers, filename=missing-seed-teacher\.jpg/,
    );
  });

  it("resolves source roots for staging, demo, and production modes", async () => {
    const scenarios = [
      { seedMode: "staging", root: "staging-images" },
      { seedMode: "demo", root: "demo-images" },
      { seedMode: "production", root: "prod-images" },
    ] as const;

    for (const scenario of scenarios) {
      const sourceDir = path.resolve(process.cwd(), "prisma", "seed-data", scenario.root, "teachers");
      await mkdir(sourceDir, { recursive: true });
      const sourceAbsolute = path.join(sourceDir, `seed-${scenario.seedMode}.jpg`);
      await writeFile(sourceAbsolute, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

      const plan = buildSeedMediaPlan(`/uploads/teachers/seed-${scenario.seedMode}.jpg`, {
        seedMode: scenario.seedMode,
      });
      expect(plan.sourceAbsolutePath).toBe(sourceAbsolute);
      await rm(sourceAbsolute, { force: true });
    }
  });

  it("rejects source filename traversal and path separators", () => {
    expect(() =>
      buildSeedMediaPlan("/uploads/teachers/seed-teacher.jpg", {
        sourceFilename: "../escape.jpg",
      }),
    ).toThrow(/cannot include '\.\.'/i);

    expect(() =>
      buildSeedMediaPlan("/uploads/teachers/seed-teacher.jpg", {
        sourceFilename: "nested/path.jpg",
      }),
    ).toThrow(/must not include path separators/i);
  });

  it("fails verification when canonical file is missing from uploads dir", async () => {
    await expect(verifySeedMediaPathExists("/uploads/classes/missing.jpg")).rejects.toThrow(
      /Seed media file missing/,
    );
  });
});
