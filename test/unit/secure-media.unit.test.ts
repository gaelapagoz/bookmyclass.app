import { describe, expect, it, vi } from "vitest";

import {
  SecureMediaError,
  assertSafeMediaPublicPath,
  getLocalMediaRenderState,
  normalizeAllowedMediaFolder,
  storeSecureImageWithPathPersistence,
  validateSecureImageFile,
  type SecureMediaFileSystem,
} from "@/lib/media";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const spoofedBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function imageFile(bytes: Uint8Array, name = "class.png", type = "image/png"): File {
  return new File([bytes], name, { type });
}

function createFileSystem(overrides: Partial<SecureMediaFileSystem> = {}): SecureMediaFileSystem {
  return {
    mkdir: vi.fn(async () => undefined) as SecureMediaFileSystem["mkdir"],
    writeFile: vi.fn(async () => undefined) as SecureMediaFileSystem["writeFile"],
    unlink: vi.fn(async () => undefined) as SecureMediaFileSystem["unlink"],
    access: vi.fn(async () => undefined) as SecureMediaFileSystem["access"],
    ...overrides,
  };
}

describe("secure media helper", () => {
  it("accepts a valid image and normalizes the generated storage path", async () => {
    const fileSystem = createFileSystem();
    const persistPath = vi.fn(async () => undefined);

    const stored = await storeSecureImageWithPathPersistence({
      file: imageFile(pngBytes),
      folder: "/images/classes",
      filenamePrefix: "Reformer Intro",
      persistPath,
      fileSystem,
    });

    expect(stored.publicPath).toMatch(/^\/images\/classes\/reformer-intro-\d+-[a-f0-9-]+\.png$/);
    expect(stored.absolutePath).toContain("public");
    expect(stored.mimeType).toBe("image/png");
    expect(fileSystem.writeFile).toHaveBeenCalledWith(stored.absolutePath, Buffer.from(pngBytes));
    expect(persistPath).toHaveBeenCalledWith(stored.publicPath);
  });

  it("rejects a spoofed image when MIME and extension do not match magic bytes", async () => {
    await expect(validateSecureImageFile(imageFile(spoofedBytes))).rejects.toMatchObject({
      code: "INVALID_MAGIC_BYTES",
    } satisfies Partial<SecureMediaError>);
  });

  it("rejects unsupported MIME types before reading image bytes", async () => {
    await expect(validateSecureImageFile(imageFile(spoofedBytes, "class.gif", "image/gif"))).rejects.toMatchObject({
      code: "INVALID_MIME_TYPE",
    } satisfies Partial<SecureMediaError>);
  });

  it("rejects extension and MIME mismatches before accepting magic bytes", async () => {
    await expect(validateSecureImageFile(imageFile(pngBytes, "class.jpg", "image/png"))).rejects.toMatchObject({
      code: "INVALID_EXTENSION",
    } satisfies Partial<SecureMediaError>);
  });

  it("rejects path traversal and non-allowed folders", () => {
    expect(() => normalizeAllowedMediaFolder("/images/classes/../private")).toThrow(SecureMediaError);
    expect(() => normalizeAllowedMediaFolder("/images/classes/../classes")).toThrow(SecureMediaError);
    expect(() => assertSafeMediaPublicPath("/images/classes/../private/file.png")).toThrow(SecureMediaError);
    expect(() => assertSafeMediaPublicPath("/images/classes/../classes/file.png")).toThrow(SecureMediaError);
    expect(() => normalizeAllowedMediaFolder("/uploads")).toThrow(SecureMediaError);
  });

  it("rejects oversized images before writing or persisting", async () => {
    const fileSystem = createFileSystem();
    const persistPath = vi.fn(async () => undefined);

    await expect(
      storeSecureImageWithPathPersistence({
        file: imageFile(pngBytes),
        folder: "/images/classes",
        filenamePrefix: "large",
        maxBytes: pngBytes.length - 1,
        persistPath,
        fileSystem,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" } satisfies Partial<SecureMediaError>);

    expect(fileSystem.writeFile).not.toHaveBeenCalled();
    expect(persistPath).not.toHaveBeenCalled();
  });

  it("does not persist a DB path when the file write fails", async () => {
    const fileSystem = createFileSystem({
      writeFile: vi.fn(async () => {
        throw new Error("DISK_FULL");
      }) as SecureMediaFileSystem["writeFile"],
    });
    const persistPath = vi.fn(async () => undefined);

    await expect(
      storeSecureImageWithPathPersistence({
        file: imageFile(pngBytes),
        folder: "/images/classes",
        filenamePrefix: "class",
        persistPath,
        fileSystem,
      }),
    ).rejects.toThrow("DISK_FULL");

    expect(persistPath).not.toHaveBeenCalled();
    expect(fileSystem.unlink).not.toHaveBeenCalled();
  });

  it("cleans up an orphan file where feasible when DB persistence fails", async () => {
    const fileSystem = createFileSystem();
    const persistPath = vi.fn(async () => {
      throw new Error("DB_WRITE_FAILED");
    });

    await expect(
      storeSecureImageWithPathPersistence({
        file: imageFile(pngBytes),
        folder: "/images/classes",
        filenamePrefix: "class",
        persistPath,
        fileSystem,
      }),
    ).rejects.toThrow("DB_WRITE_FAILED");

    expect(fileSystem.writeFile).toHaveBeenCalledTimes(1);
    expect(fileSystem.unlink).toHaveBeenCalledTimes(1);
    expect(fileSystem.unlink).toHaveBeenCalledWith(expect.stringContaining("public"));
  });

  it("returns fallback state when a DB-referenced local media file is missing", async () => {
    const fileSystem = createFileSystem({
      access: vi.fn(async () => {
        throw new Error("ENOENT");
      }) as SecureMediaFileSystem["access"],
    });

    await expect(getLocalMediaRenderState("/images/classes/missing.png", { fileSystem })).resolves.toEqual({
      src: null,
      shouldRenderFallback: true,
    });
  });
});
