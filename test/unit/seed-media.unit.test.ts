import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

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
  });

  it("maps legacy seeded paths to canonical uploads paths", () => {
    expect(toCanonicalSeedImagePath("/images/instructors/ana.jpg")).toBe("/uploads/teachers/ana.jpg");
    expect(toCanonicalSeedImagePath("/images/classes/vinyasa.jpg")).toBe("/uploads/classes/vinyasa.jpg");
    expect(toCanonicalSeedImagePath("/images/learning/course.jpg")).toBe("/uploads/learning/course.jpg");
    expect(toCanonicalSeedImagePath("/uploads/products/item.jpg")).toBe("/uploads/products/item.jpg");
  });

  it("builds deterministic store filenames from product slug", () => {
    expect(buildStoreSeedAssetFilename("store-gift-card-25-eur")).toBe("store-gift-card-25-eur.jpg");
    expect(buildStoreSeedAssetFilename("Store Merch Yoga Mat")).toBe("store-merch-yoga-mat.jpg");
  });

  it("copies canonical seed media to UPLOADS_DIR and is idempotent", async () => {
    const sourceDir = path.resolve(process.cwd(), "public", "images", "instructors");
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

  it("fails verification when canonical file is missing from uploads dir", async () => {
    await expect(verifySeedMediaPathExists("/uploads/classes/missing.jpg")).rejects.toThrow(
      /Seed media file missing/,
    );
  });
});
