import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = process.cwd();
const testRoot = resolve(repoRoot, "test");
const excludedDirectoryPath = normalizePathForComparison(resolve(testRoot, "e2e"));
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/i;

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+/g, "/");
}

function isOption(value: string): boolean {
  return value.startsWith("-");
}

function collectTestFiles(dir: string, output: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    const normalizedFullPath = normalizePathForComparison(fullPath);

    if (entry.isDirectory()) {
      if (
        normalizedFullPath === excludedDirectoryPath ||
        normalizedFullPath.startsWith(`${excludedDirectoryPath}/`)
      ) {
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

function resolveRequestedFiles(args: string[]): string[] {
  const requestedFiles = args.filter((arg) => !isOption(arg));
  if (requestedFiles.length > 0) {
    return requestedFiles;
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

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--run");
const passthroughArgs = rawArgs.filter(isOption);
const files = resolveRequestedFiles(rawArgs);

if (files.length === 0) {
  console.error("[vitest-runner] No test files found.");
  process.exit(1);
}

for (const [index, file] of files.entries()) {
  console.log(`[vitest-runner] (${index + 1}/${files.length}) ${file}`);
  const exitCode = runVitestForFile(file, passthroughArgs);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

console.log(`[vitest-runner] Completed ${files.length} file(s).`);
