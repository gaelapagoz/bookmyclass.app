import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyMediaRuntime } from "../../scripts/verify-media-runtime";

describe("verifyMediaRuntime", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("checks write access and returns only a public upload path", async () => {
    const uploadsDir = await mkdtemp(path.join(os.tmpdir(), "bookmyclass-media-"));
    tempDirs.push(uploadsDir);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPLOADS_DIR", uploadsDir);
    vi.stubEnv("PUBLIC_UPLOADS_BASE_PATH", "/uploads");

    const result = await verifyMediaRuntime();

    expect(result.uploadsDir).toBe(path.resolve(uploadsDir));
    expect(result.testPublicPath).toMatch(/^\/uploads\/products\/\.media-runtime-[0-9a-f-]+\.txt$/);
    expect(result.testPublicPath).not.toContain(path.resolve(uploadsDir));
  });
});
