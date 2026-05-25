import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMediaLibraryImages } from "@/lib/media/media-library";

const tempDirs: string[] = [];

describe("media library", () => {
  let uploadsDir: string;

  beforeEach(async () => {
    uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-media-library-"));
    tempDirs.push(uploadsDir);
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");
    await mkdir(path.join(uploadsDir, "learning"), { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns canonical learning items from UPLOADS_DIR and filters non-images", async () => {
    await writeFile(path.join(uploadsDir, "learning", "a.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    await writeFile(path.join(uploadsDir, "learning", "notes.txt"), "skip", "utf8");
    await writeFile(path.join(uploadsDir, "learning", "b.webp"), Buffer.from("RIFFxxxxWEBP", "ascii"));

    const items = await listMediaLibraryImages("learning");

    expect(items).toEqual([
      { path: "/uploads/learning/a.jpg", name: "a.jpg" },
      { path: "/uploads/learning/b.webp", name: "b.webp" },
    ]);
  });

  it("rejects non-canonical folders at runtime", async () => {
    await expect(listMediaLibraryImages("marketing")).rejects.toThrow("Media folder is not allowed.");
    await expect(
      listMediaLibraryImages("invalid-folder" as unknown as "learning"),
    ).rejects.toThrow("Media folder is not allowed.");
  });
});
