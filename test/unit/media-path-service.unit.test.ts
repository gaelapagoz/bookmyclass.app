import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanonicalMediaPublicPath,
  getCanonicalMediaRenderState,
  toCanonicalMediaAbsolutePath,
} from "@/lib/media";

const tempDirs: string[] = [];

describe("media path service", () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-media-path-"));
    tempDirs.push(uploadsDir);
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("accepts canonical uploads path within allowed folder", () => {
    expect(assertCanonicalMediaPublicPath("/uploads/teachers/example.png", ["teachers"])).toBe(
      "/uploads/teachers/example.png",
    );
  });

  it("rejects traversal and disallowed-folder paths", () => {
    expect(() => assertCanonicalMediaPublicPath("/uploads/teachers/../escape.png", ["teachers"])).toThrow(
      "MEDIA_PATH_INVALID",
    );
    expect(() => assertCanonicalMediaPublicPath("/uploads/products/example.png", ["teachers"])).toThrow(
      "MEDIA_PATH_OUTSIDE_ALLOWED_FOLDER",
    );
    expect(() => assertCanonicalMediaPublicPath("/upload/teachers/example.png", ["teachers"])).toThrow(
      "MEDIA_PATH_OUTSIDE_UPLOADS",
    );
    expect(() => assertCanonicalMediaPublicPath("uploads/teachers/example.png", ["teachers"])).toThrow(
      "MEDIA_PATH_INVALID",
    );
    expect(() => assertCanonicalMediaPublicPath("/uploads/teachers/", ["teachers"])).toThrow(
      "MEDIA_PATH_OUTSIDE_ALLOWED_FOLDER",
    );
  });

  it("resolves absolute filesystem path under UPLOADS_DIR", () => {
    const absolutePath = toCanonicalMediaAbsolutePath("/uploads/classes/sample.png");
    expect(absolutePath).toBe(path.resolve(uploadsDir, "classes", "sample.png"));
  });

  it("returns render src without fallback when canonical file exists", async () => {
    const absolutePath = toCanonicalMediaAbsolutePath("/uploads/learning/ok.png");
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    await expect(getCanonicalMediaRenderState("/uploads/learning/ok.png", { allowedFolders: ["learning"] })).resolves.toEqual({
      src: "/uploads/learning/ok.png",
      shouldRenderFallback: false,
    });
  });

  it("returns fallback for invalid canonical render paths", async () => {
    await expect(getCanonicalMediaRenderState("/upload/learning/ok.png", { allowedFolders: ["learning"] })).resolves.toEqual({
      src: null,
      shouldRenderFallback: true,
    });
  });

  it("returns fallback for legacy public image paths", async () => {
    const legacyLearningPath = ["/images", "learning", "legacy.png"].join("/");
    await expect(getCanonicalMediaRenderState(legacyLearningPath, { allowedFolders: ["learning"] })).resolves.toEqual({
      src: null,
      shouldRenderFallback: true,
    });
  });
});
