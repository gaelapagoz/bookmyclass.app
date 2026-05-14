import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { assertContainedPath, resolveUploadsConfig } from "../src/lib/media/upload-config";

export type MediaRuntimeVerificationResult = {
  readonly uploadsDir: string;
  readonly testPublicPath: string;
};

export async function verifyMediaRuntime(): Promise<MediaRuntimeVerificationResult> {
  const config = resolveUploadsConfig();
  const productDir = path.resolve(config.uploadsDir, "products");
  const testFilename = `.media-runtime-${randomUUID()}.txt`;
  const testAbsolutePath = path.resolve(productDir, testFilename);
  const testPublicPath = `${config.publicUploadsBasePath}/products/${testFilename}`;

  assertContainedPath(productDir, testAbsolutePath);

  if (!testPublicPath.startsWith("/uploads/products/")) {
    throw new Error(`Generated public path is not under /uploads/products/: ${testPublicPath}`);
  }

  if (path.isAbsolute(testPublicPath.slice(1)) || testPublicPath.includes("\\") || testPublicPath.includes("..")) {
    throw new Error(`Generated public path is unsafe: ${testPublicPath}`);
  }

  await access(config.uploadsDir);
  await mkdir(productDir, { recursive: true });
  await writeFile(testAbsolutePath, "ok\n", { flag: "wx" });
  await unlink(testAbsolutePath);

  return {
    uploadsDir: config.uploadsDir,
    testPublicPath,
  };
}

if (process.env.NODE_ENV !== "test") {
  verifyMediaRuntime()
    .then((result) => {
      console.log("[media-runtime] ok", result);
    })
    .catch((error: unknown) => {
      console.error("[media-runtime] failed", error);
      process.exitCode = 1;
    });
}
