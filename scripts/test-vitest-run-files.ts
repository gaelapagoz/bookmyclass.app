/**
 * Test vitest run files
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/test-vitest-run-files.ts
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const testRoot = resolve(repoRoot, "test");
const excludedDirectoryPaths = [
  resolve(testRoot, "e2e"),
  resolve(testRoot, "manual", "demo-screenshots"),
].map(normalizePathForComparison);
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+/g, "/");
}

function isOption(value: string): boolean {
  return value.startsWith("-");
}

function isConfigLikePath(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.endsWith(".config.ts")
    || normalized.endsWith(".config.js")
    || normalized.endsWith(".config.mts")
    || normalized.endsWith(".config.mjs")
    || normalized.endsWith(".config.cts")
    || normalized.endsWith(".config.cjs");
}

function parseRunnerArgs(args: string[]): { vitestArgs: string[]; requestedPaths: string[] } {
  const vitestArgs: string[] = [];
  const requestedPaths: string[] = [];
  const valueOptions = new Set(["--config", "-c"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--run") {
      continue;
    }

    if (!isOption(arg)) {
      requestedPaths.push(arg);
      continue;
    }

    vitestArgs.push(arg);

    if (valueOptions.has(arg) && index + 1 < args.length) {
      const nextValue = args[index + 1];
      vitestArgs.push(nextValue);
      index += 1;
    }
  }

  return { vitestArgs, requestedPaths };
}

function collectTestFiles(dir: string, output: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const normalizedFullPath = normalizePathForComparison(fullPath);

    if (entry.isDirectory()) {
      if (excludedDirectoryPaths.some((excludedPath) => (
        normalizedFullPath === excludedPath ||
        normalizedFullPath.startsWith(`${excludedPath}/`)
      ))) {
        continue;
      }

      collectTestFiles(fullPath, output);
      continue;
    }

    if (entry.isFile() && testFilePattern.test(entry.name)) {
      output.push(relative(repoRoot, fullPath));
    }
  }
}

function resolveRequestedPath(arg: string): string[] {
  const fullPath = resolve(repoRoot, arg);
  if (!existsSync(fullPath)) {
    return [arg];
  }

  const stat = statSync(fullPath);
  if (!stat.isDirectory()) {
    return [arg];
  }

  const discovered: string[] = [];
  collectTestFiles(fullPath, discovered);
  return discovered.sort((left, right) => left.localeCompare(right));
}

function resolveRequestedFiles(requestedFiles: string[]): string[] {
  if (requestedFiles.length > 0) {
    const filteredRequestedFiles = requestedFiles.filter((arg) => !isConfigLikePath(arg));
    if (filteredRequestedFiles.length > 0) {
      return filteredRequestedFiles.flatMap(resolveRequestedPath);
    }
  }

  const discovered: string[] = [];
  collectTestFiles(testRoot, discovered);
  return discovered.sort((left, right) => left.localeCompare(right));
}

function runVitestForFile(file: string, extraArgs: string[]): number {
  const args = process.platform === "win32"
    ? ["/c", "npx", "vitest", "--run", file, ...extraArgs]
    : ["vitest", "--run", file, ...extraArgs];

  const command = process.platform === "win32" ? "cmd" : "npx";
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  return result.status ?? 1;
}

const parsedArgs = parseRunnerArgs(process.argv.slice(2));
const files = resolveRequestedFiles(parsedArgs.requestedPaths);

if (files.length === 0) {
  console.error("[vitest-runner] No test files found.");
  process.exit(1);
}

for (const [index, file] of files.entries()) {
  console.log(`[vitest-runner] (${index + 1}/${files.length}) ${file}`);
  const exitCode = runVitestForFile(file, parsedArgs.vitestArgs);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

console.log(`[vitest-runner] Completed ${files.length} file(s).`);
