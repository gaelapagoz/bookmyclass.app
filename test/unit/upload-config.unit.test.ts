import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCAL_UPLOADS_DIR,
  assertContainedPath,
  resolveUploadsConfig,
  UploadsConfigError,
} from "@/lib/media/upload-config";

describe("upload config", () => {
  it("uses a local-only uploads default outside production", () => {
    const config = resolveUploadsConfig({ NODE_ENV: "test" });

    expect(config.uploadsDir).toBe(DEFAULT_LOCAL_UPLOADS_DIR);
    expect(config.uploadsDir).toContain(`${path.sep}.local${path.sep}uploads`);
    expect(config.publicUploadsBasePath).toBe("/uploads");
  });

  it("requires UPLOADS_DIR in production", () => {
    expect(() => resolveUploadsConfig({ NODE_ENV: "production" })).toThrow(UploadsConfigError);
    expect(() => resolveUploadsConfig({ NODE_ENV: "production" })).toThrow(/UPLOADS_DIR/);
  });

  it("rejects production uploads inside the app release directory", () => {
    expect(() =>
      resolveUploadsConfig({
        NODE_ENV: "production",
        UPLOADS_DIR: path.join(process.cwd(), "public", "uploads"),
      }),
    ).toThrow(/outside the application release directory/);
  });

  it("keeps target files inside the upload root", () => {
    const root = path.resolve("/var/lib/bookmyclass/uploads/products");

    expect(() => assertContainedPath(root, path.join(root, "image.png"))).not.toThrow();
    expect(() => assertContainedPath(root, path.join(root, "..", "escape.png"))).toThrow(UploadsConfigError);
  });
});
