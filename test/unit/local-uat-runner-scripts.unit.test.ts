import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_ARTIFACT_LINES = [
  "k6-discover.log",
  "discovered-services.json",
  "discovered-products.json",
  "k6-summary.json",
  "k6-output.log",
  "run-meta.env",
  "exit-code.txt",
  "quick-summary.txt",
];

const REQUIRED_DISCOVERY_LINES = [
  'npm run k6:discover:uat',
  "cp k6/data/services.json",
  "cp k6/data/products.json",
];

type RunnerSpec = {
  file: string;
  expectedDefaultStage: string;
};

const RUNNER_SPECS: RunnerSpec[] = [
  { file: "scripts/local-uat-run-smoke.sh", expectedDefaultStage: "smoke" },
  { file: "scripts/local-uat-run-t50.sh", expectedDefaultStage: "t50" },
  { file: "scripts/local-uat-run-t100.sh", expectedDefaultStage: "t100" },
];

describe("local UAT perf runner scripts", () => {
  it("keeps only active local-uat-run scripts in scripts root", () => {
    const scriptsDir = resolve(process.cwd(), "scripts");
    const runnerFiles = readdirSync(scriptsDir)
      .filter((name) => name.startsWith("local-uat-run-") && name.endsWith(".sh"))
      .sort();

    expect(runnerFiles).toEqual([
      "local-uat-run-smoke.sh",
      "local-uat-run-t100.sh",
      "local-uat-run-t50.sh",
    ]);
  });

  for (const runner of RUNNER_SPECS) {
    it(`keeps artifact/discovery parity for ${runner.expectedDefaultStage}`, () => {
      const path = resolve(process.cwd(), runner.file);
      const script = readFileSync(path, "utf8");

      expect(script).toContain(`STAGE_PROFILE="\${STAGE_PROFILE:-${runner.expectedDefaultStage}}"`);
      expect(script).toContain('K6_SCENARIO_SET="${K6_SCENARIO_SET:-full_smoke}"');

      for (const discoveryLine of REQUIRED_DISCOVERY_LINES) {
        expect(script).toContain(discoveryLine);
      }

      for (const artifactLine of REQUIRED_ARTIFACT_LINES) {
        expect(script).toContain(artifactLine);
      }
    });
  }
});
