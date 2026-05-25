import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function run(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function runNodeCommand(command: string, args: string[]): number {
  if (process.platform === "win32") {
    return run("cmd", ["/c", command, ...args]);
  }
  return run(command, args);
}

function isOption(value: string): boolean {
  return value.startsWith("-");
}

function normalizePathForComparison(value: string): string {
  return value.replace(/[\\/]+/g, "/");
}

function resolveCategoryFromPath(arg: string): "unit" | "ui" | "integration" | null {
  const fullPath = normalizePathForComparison(resolve(process.cwd(), arg));
  const unitRoot = normalizePathForComparison(resolve(process.cwd(), "test", "unit"));
  const uiRoot = normalizePathForComparison(resolve(process.cwd(), "test", "ui"));
  const integrationRoot = normalizePathForComparison(resolve(process.cwd(), "test", "integration"));

  if (fullPath === unitRoot || fullPath.startsWith(`${unitRoot}/`)) return "unit";
  if (fullPath === uiRoot || fullPath.startsWith(`${uiRoot}/`)) return "ui";
  if (fullPath === integrationRoot || fullPath.startsWith(`${integrationRoot}/`)) return "integration";
  return null;
}

function splitPassthroughArgs(args: string[]): { sharedOptions: string[]; requestedPaths: string[] } {
  const sharedOptions: string[] = [];
  const requestedPaths: string[] = [];
  const valueOptions = new Set(["--config", "-c"]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!isOption(arg)) {
      requestedPaths.push(arg);
      continue;
    }

    if (arg === "--run") {
      continue;
    }

    sharedOptions.push(arg);
    if (valueOptions.has(arg) && index + 1 < args.length) {
      sharedOptions.push(args[index + 1]);
      index += 1;
    }
  }

  return { sharedOptions, requestedPaths };
}

function runLanes(input?: { sharedOptions: string[]; requestedPaths: string[] }): number {
  const sharedOptions = input?.sharedOptions ?? [];
  const requestedPaths = input?.requestedPaths ?? [];

  const runAllLanes = requestedPaths.length === 0;
  const categories = new Set(requestedPaths.map(resolveCategoryFromPath).filter(Boolean));

  const shouldRunUnit = runAllLanes || categories.has("unit");
  const shouldRunUi = runAllLanes || categories.has("ui");
  const shouldRunIntegration = runAllLanes || categories.has("integration");

  if (shouldRunUnit) {
    const unitArgs = ["vitest", "--config", "vitest.unit.config.ts", "--run", ...sharedOptions];
    if (!runAllLanes) {
      unitArgs.push(...requestedPaths.filter((path) => resolveCategoryFromPath(path) === "unit"));
    }
    const unitCode = runNodeCommand("npx", unitArgs);
    if (unitCode !== 0) return unitCode;
  }

  if (shouldRunUi) {
    const uiArgs = ["vitest", "--config", "vitest.ui.config.ts", "--run", ...sharedOptions];
    if (!runAllLanes) {
      uiArgs.push(...requestedPaths.filter((path) => resolveCategoryFromPath(path) === "ui"));
    }
    const uiCode = runNodeCommand("npx", uiArgs);
    if (uiCode !== 0) return uiCode;
  }

  if (shouldRunIntegration) {
    const integrationArgs = ["scripts/test-vitest-run-files.ts", "--config", "vitest.integration.config.ts", "--run", ...sharedOptions];
    if (runAllLanes) {
      integrationArgs.push("test/integration");
    } else {
      integrationArgs.push(...requestedPaths.filter((path) => resolveCategoryFromPath(path) === "integration"));
    }
    const integrationCode = runNodeCommand("tsx", integrationArgs);
    if (integrationCode !== 0) return integrationCode;
  }

  if (!runAllLanes && categories.size === 0) {
    console.error("[test-entry] No matching test lanes for requested paths. Use test/unit, test/ui, or test/integration.");
    return 1;
  }

  return 0;
}

function main() {
  const passthroughArgs = process.argv.slice(2);

  if (passthroughArgs.length > 0) {
    const parsed = splitPassthroughArgs(passthroughArgs);
    const code = runLanes(parsed);
    process.exit(code);
  }

  process.exit(runLanes({ sharedOptions: [], requestedPaths: [] }));
}

main();
