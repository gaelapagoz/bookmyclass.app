import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { assertContainedPath, resolveUploadsConfig } from "../src/lib/media/upload-config";
import { CANONICAL_MEDIA_FOLDERS } from "../src/lib/media/media-upload-service";

export type MediaRuntimeVerificationResult = {
  readonly uploadsDir: string;
  readonly testPublicPaths: string[];
};

export async function verifyMediaRuntime(): Promise<MediaRuntimeVerificationResult> {
  const config = resolveUploadsConfig();
  await access(config.uploadsDir);
  const testPublicPaths: string[] = [];

  for (const folder of CANONICAL_MEDIA_FOLDERS) {
    const folderDir = path.resolve(config.uploadsDir, folder);
    const testFilename = `.media-runtime-${randomUUID()}.txt`;
    const testAbsolutePath = path.resolve(folderDir, testFilename);
    const testPublicPath = `${config.publicUploadsBasePath}/${folder}/${testFilename}`;

    assertContainedPath(folderDir, testAbsolutePath);

    if (!testPublicPath.startsWith(`/uploads/${folder}/`)) {
      throw new Error(`Generated public path is not under /uploads/${folder}/: ${testPublicPath}`);
    }

    if (path.isAbsolute(testPublicPath.slice(1)) || testPublicPath.includes("\\") || testPublicPath.includes("..")) {
      throw new Error(`Generated public path is unsafe: ${testPublicPath}`);
    }

    await mkdir(folderDir, { recursive: true });
    await writeFile(testAbsolutePath, "ok\n", { flag: "wx" });
    await unlink(testAbsolutePath);
    testPublicPaths.push(testPublicPath);
  }

  return {
    uploadsDir: config.uploadsDir,
    testPublicPaths,
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
