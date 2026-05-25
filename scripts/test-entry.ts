import { spawnSync } from "node:child_process";

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

function main() {
  const passthroughArgs = process.argv.slice(2);

  if (passthroughArgs.length > 0) {
    const hasConfigArg = passthroughArgs.some((arg, index) => arg === "--config" || arg === "-c" || (
      index > 0 && (passthroughArgs[index - 1] === "--config" || passthroughArgs[index - 1] === "-c")
    ));
    const runnerArgs = hasConfigArg
      ? passthroughArgs
      : ["--config", "vitest.integration.config.ts", ...passthroughArgs];
    const code = runNodeCommand("tsx", ["scripts/test-vitest-run-files.ts", ...runnerArgs]);
    process.exit(code);
  }

  const unitCode = runNodeCommand("npm", ["run", "test:unit"]);
  if (unitCode !== 0) {
    process.exit(unitCode);
  }

  const integrationCode = runNodeCommand("npm", ["run", "test:integration"]);
  process.exit(integrationCode);
}

main();
