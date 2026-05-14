import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CanonicalMediaError,
  getCanonicalMediaRenderState,
  storeCanonicalImageWithPathPersistence,
  validateCanonicalImageFile,
} from "@/lib/media";

const tempDirs: string[] = [];
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function imageFile(bytes: Uint8Array, name = "image.png", type = "image/png"): File {
  return new File([bytes], name, { type });
}

function absoluteFromPublicPath(publicPath: string, uploadsDir: string): string {
  return path.join(uploadsDir, publicPath.replace(/^\/uploads\//, ""));
}

describe("canonical media service", () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-canonical-media-"));
    tempDirs.push(uploadsDir);
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("stores validated images under UPLOADS_DIR and returns a stable /uploads path", async () => {
    const stored = await storeCanonicalImageWithPathPersistence({
      file: imageFile(pngBytes, "teacher.png"),
      folder: "teachers",
      filenamePrefix: "Teacher One",
    });

    expect(stored.publicPath).toMatch(/^\/uploads\/teachers\/teacher-one-\d+-[a-f0-9-]+\.png$/);
    expect(stored.absolutePath).toBe(absoluteFromPublicPath(stored.publicPath, uploadsDir));
    expect(stored.absolutePath).not.toContain(path.join(process.cwd(), "public"));
    expect(existsSync(stored.absolutePath)).toBe(true);
  });

  it("rejects traversal, invalid MIME, extension mismatch, magic-byte mismatch, and oversized images", async () => {
    await expect(validateCanonicalImageFile(imageFile(pngBytes, "../bad.png"))).rejects.toMatchObject({
      code: "UNSAFE_FILENAME",
    } satisfies Partial<CanonicalMediaError>);
    await expect(validateCanonicalImageFile(imageFile(new Uint8Array([1, 2, 3]), "bad.txt", "text/plain"))).rejects.toMatchObject({
      code: "INVALID_MIME_TYPE",
    } satisfies Partial<CanonicalMediaError>);
    await expect(validateCanonicalImageFile(imageFile(pngBytes, "bad.jpg", "image/png"))).rejects.toMatchObject({
      code: "INVALID_EXTENSION",
    } satisfies Partial<CanonicalMediaError>);
    await expect(validateCanonicalImageFile(imageFile(new Uint8Array([0x47, 0x49, 0x46]), "bad.png"))).rejects.toMatchObject({
      code: "INVALID_MAGIC_BYTES",
    } satisfies Partial<CanonicalMediaError>);
    await expect(validateCanonicalImageFile(imageFile(pngBytes), { maxBytes: pngBytes.length - 1 })).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    } satisfies Partial<CanonicalMediaError>);
  });

  it("cleans up the uploaded file when DB path persistence fails", async () => {
    let writtenPath = "";

    await expect(
      storeCanonicalImageWithPathPersistence({
        file: imageFile(pngBytes, "class.png"),
        folder: "classes",
        filenamePrefix: "Class",
        persistPath: async (_publicPath, stored) => {
          writtenPath = stored.absolutePath;
          throw new Error("DB_WRITE_FAILED");
        },
      }),
    ).rejects.toThrow("DB_WRITE_FAILED");

    expect(writtenPath).toBeTruthy();
    expect(existsSync(writtenPath)).toBe(false);
  });

  it("returns fallback state when an uploaded file is missing", async () => {
    await expect(getCanonicalMediaRenderState("/uploads/products/missing.png", { allowedFolders: ["products"] })).resolves.toEqual({
      src: null,
      shouldRenderFallback: true,
    });
  });
});
