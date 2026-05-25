import { isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";
import path from "node:path";

export const DEFAULT_PUBLIC_UPLOADS_BASE_PATH = "/uploads";
export const DEFAULT_LOCAL_UPLOADS_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  ".local",
  "uploads",
);

export type UploadsConfig = {
  readonly uploadsDir: string;
  readonly publicUploadsBasePath: string;
};

export class UploadsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadsConfigError";
  }
}

export function normalizePublicUploadsBasePath(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_PUBLIC_UPLOADS_BASE_PATH;
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const rootRelativePath = withLeadingSlash.replaceAll("\\", "/");
  if (rootRelativePath.split("/").includes("..")) {
    throw new UploadsConfigError("PUBLIC_UPLOADS_BASE_PATH must not contain traversal.");
  }

  const normalized = path.posix.normalize(rootRelativePath).replace(/\/+$/, "");

  if (normalized !== DEFAULT_PUBLIC_UPLOADS_BASE_PATH) {
    throw new UploadsConfigError("PUBLIC_UPLOADS_BASE_PATH must be /uploads for the current production media contract.");
  }

  return normalized;
}

export function resolveUploadsConfig(env: NodeJS.ProcessEnv = process.env): UploadsConfig {
  const isProduction = env.NODE_ENV === "production";
  const isE2eTestMode = env === process.env
    ? isE2ETestModeEnabled()
    : env.E2E_TEST_MODE === "1" && env.NODE_ENV !== "production";
  const configuredUploadsDir = env.UPLOADS_DIR?.trim();

  if (isProduction && !configuredUploadsDir && !isE2eTestMode) {
    throw new UploadsConfigError("UPLOADS_DIR is required in production.");
  }

  const uploadsDir = path.resolve(configuredUploadsDir || DEFAULT_LOCAL_UPLOADS_DIR);
  const publicUploadsBasePath = normalizePublicUploadsBasePath(env.PUBLIC_UPLOADS_BASE_PATH);

  if (isProduction && !isE2eTestMode) {
    assertSafeProductionUploadsDir(uploadsDir);
  }

  return {
    uploadsDir,
    publicUploadsBasePath,
  };
}

export function assertContainedPath(rootDir: string, targetPath: string): void {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative) || relative === "") {
    throw new UploadsConfigError("Upload target path must stay inside UPLOADS_DIR.");
  }
}

function assertSafeProductionUploadsDir(uploadsDir: string): void {
  const cwd = path.resolve(/* turbopackIgnore: true */ process.cwd());
  const unsafeRoots = [
    cwd,
    path.resolve(cwd, "public"),
    path.resolve(cwd, ".next"),
  ];

  for (const unsafeRoot of unsafeRoots) {
    const relative = path.relative(unsafeRoot, uploadsDir);
    if (uploadsDir === unsafeRoot || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      throw new UploadsConfigError(
        "UPLOADS_DIR must be outside the application release directory in production.",
      );
    }
  }
}
