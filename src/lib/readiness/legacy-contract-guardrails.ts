import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const PHASE0_BANNED_LEGACY_TOKENS = [
  ["uat", "performance"].join("-"),
  ["/images", "instructors"].join("/"),
  ["/images", "classes"].join("/"),
  ["/images", "learning"].join("/"),
] as const;

const DEFAULT_CONTRACT_ROOTS = ["src", "prisma", "scripts", ".github/workflows", "test", "package.json"] as const;

const DEFAULT_CONTRACT_EXCLUDES = [".roadmap", "node_modules", ".next", "dist", "build", "coverage", "test-results", "playwright-report"] as const;

const DEFAULT_CONTRACT_LEGACY_FILE_EXCLUSIONS: readonly string[] = [];

const DEFAULT_DOCS_EXCLUDES: readonly string[] = [];

const REQUIRED_E2E_GITIGNORE_RULES = [".local/e2e-uploads/**", "/.local/e2e-uploads/**"] as const;
const REQUIRED_LOCAL_UPLOADS_GITIGNORE_RULES = [".local/uploads/**", "/.local/uploads/**"] as const;

export type LegacyFinding = {
  readonly filePath: string;
  readonly line: number;
  readonly token: string;
};

export type SeedModePhase0 = "development" | "staging" | "demo" | "production";

export function verifySeedDataPreflight(mode: SeedModePhase0, cwd: string = process.cwd()): void {
  const required =
    mode === "production"
      ? [
          "prisma/seed-data/prod-images/teachers",
          "prisma/seed-data/prod-images/classes",
          "prisma/seed-data/prod-images/learning",
          "prisma/seed-data/prod-images/products",
        ]
      : mode === "development"
        ? [
            "prisma/seed-data/dev-images/teachers",
            "prisma/seed-data/dev-images/classes",
            "prisma/seed-data/dev-images/learning",
            "prisma/seed-data/dev-images/products",
            "prisma/seed-data/learning-content.json",
          ]
        : mode === "staging"
          ? [
              "prisma/seed-data/staging-images/teachers",
              "prisma/seed-data/staging-images/classes",
              "prisma/seed-data/staging-images/learning",
              "prisma/seed-data/staging-images/products",
              "prisma/seed-data/learning-content.json",
            ]
          : [
              "prisma/seed-data/demo-images/teachers",
              "prisma/seed-data/demo-images/classes",
              "prisma/seed-data/demo-images/learning",
              "prisma/seed-data/demo-images/products",
              "prisma/seed-data/learning-content.json",
            ];

  const missing = required
    .map((relativePath) => ({
      relativePath,
      absolutePath: path.resolve(cwd, relativePath),
    }))
    .filter((entry) => !existsSync(entry.absolutePath));

  if (missing.length > 0) {
    const details = missing.map((entry) => `- ${entry.relativePath} (${entry.absolutePath})`).join("\n");
    throw new Error(`[seed:preflight] Missing required seed-data paths for mode=${mode}:\n${details}`);
  }
}

export async function findLegacyContractFindings(options?: {
  readonly cwd?: string;
  readonly roots?: readonly string[];
  readonly excludes?: readonly string[];
  readonly tokens?: readonly string[];
}): Promise<LegacyFinding[]> {
  const cwd = options?.cwd ?? process.cwd();
  const roots = options?.roots ?? DEFAULT_CONTRACT_ROOTS;
  const excludes = options?.excludes ?? DEFAULT_CONTRACT_EXCLUDES;
  const tokens = options?.tokens ?? PHASE0_BANNED_LEGACY_TOKENS;

  const files = await collectFiles(cwd, roots, excludes);
  const allowedFiles = DEFAULT_CONTRACT_LEGACY_FILE_EXCLUSIONS.map((item) => item.replaceAll("\\", "/"));
  const scopedFiles = files.filter((file) => {
    const relative = path.relative(cwd, file).replaceAll("\\", "/");
    return !allowedFiles.some((allowed) => (allowed.endsWith("/") ? relative.startsWith(allowed) : relative === allowed));
  });
  return findLegacyTokensInFiles(cwd, scopedFiles, tokens);
}

export async function findLegacyDocFindings(options?: {
  readonly cwd?: string;
  readonly roots?: readonly string[];
  readonly excludes?: readonly string[];
  readonly tokens?: readonly string[];
}): Promise<LegacyFinding[]> {
  const cwd = options?.cwd ?? process.cwd();
  const roots = options?.roots ?? ["docs"];
  const excludes = options?.excludes ?? DEFAULT_DOCS_EXCLUDES;
  const tokens = options?.tokens ?? PHASE0_BANNED_LEGACY_TOKENS;

  const files = await collectFiles(cwd, roots, excludes);
  return findLegacyTokensInFiles(cwd, files, tokens);
}

export async function findDisallowedE2EArtifacts(cwd: string = process.cwd()): Promise<string[]> {
  const result: string[] = [];
  const localUploadsRoot = path.resolve(cwd, ".local", "uploads");
  if (existsSync(localUploadsRoot)) {
    const files = await collectAllFiles(localUploadsRoot);
    for (const file of files) {
      const relative = path.relative(cwd, file).replaceAll("\\", "/");
      if (!isLikelyE2EUploadArtifact(relative)) {
        continue;
      }
      result.push(relative);
    }
  }

  const publicImagesRoot = path.resolve(cwd, "public", "images");
  if (existsSync(publicImagesRoot)) {
    const files = await collectAllFiles(publicImagesRoot);
    for (const file of files) {
      const relative = path.relative(cwd, file).replaceAll("\\", "/");
      if (!isLikelyE2EUploadArtifact(relative)) {
        continue;
      }
      result.push(relative);
    }
  }

  return result.sort((a, b) => a.localeCompare(b));
}

export async function verifyE2EArtifactGitignoreCoverage(cwd: string = process.cwd()): Promise<void> {
  const gitignorePath = path.resolve(cwd, ".gitignore");
  if (!existsSync(gitignorePath)) {
    throw new Error("[verify:e2e-artifacts] Missing .gitignore file.");
  }

  const content = await readFile(gitignorePath, "utf8");
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const hasRequiredRule = REQUIRED_E2E_GITIGNORE_RULES.some((rule) => lines.includes(rule));
  if (!hasRequiredRule) {
    throw new Error(
      `[verify:e2e-artifacts] .gitignore must include one of: ${REQUIRED_E2E_GITIGNORE_RULES.join(", ")}`,
    );
  }

  const hasLocalUploadsRule = REQUIRED_LOCAL_UPLOADS_GITIGNORE_RULES.some((rule) => lines.includes(rule));
  if (!hasLocalUploadsRule) {
    throw new Error(
      `[verify:e2e-artifacts] .gitignore must include one of: ${REQUIRED_LOCAL_UPLOADS_GITIGNORE_RULES.join(", ")}`,
    );
  }
}

async function collectFiles(cwd: string, roots: readonly string[], excludes: readonly string[]): Promise<string[]> {
  const all: string[] = [];
  const excludeAbsolute = excludes.map((item) => path.resolve(cwd, item));
  for (const root of roots) {
    const absolute = path.resolve(cwd, root);
    if (!existsSync(absolute)) {
      continue;
    }

    if (excludeAbsolute.some((excluded) => absolute.startsWith(excluded))) {
      continue;
    }

    const info = await stat(absolute).catch(() => null);
    if (!info) {
      continue;
    }

    if (info.isDirectory()) {
      all.push(...(await collectAllFiles(absolute, excludeAbsolute)));
      continue;
    }

    all.push(absolute);
  }

  return all;
}

async function findLegacyTokensInFiles(cwd: string, files: readonly string[], tokens: readonly string[]): Promise<LegacyFinding[]> {
  const findings: LegacyFinding[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => null);
    if (content === null) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      for (const token of tokens) {
        if (line.includes(token)) {
          findings.push({ filePath: path.relative(cwd, file).replaceAll("\\", "/"), line: index + 1, token });
        }
      }
    }
  }

  return findings;
}

async function collectAllFiles(root: string, excludeAbsolute: readonly string[] = []): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.resolve(root, entry.name);
    if (excludeAbsolute.some((excluded) => absolute.startsWith(excluded))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...(await collectAllFiles(absolute, excludeAbsolute)));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

function isLikelyE2EUploadArtifact(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  const name = path.basename(lower);
  return (
    lower.includes("/service-e2e-service-") ||
    name.startsWith("service-e2e-service-") ||
    lower.includes("/e2e-")
  );
}
