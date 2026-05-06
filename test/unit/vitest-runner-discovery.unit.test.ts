import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("vitest runner discovery", () => {
  it("excludes Playwright-only test directories from npm test discovery", () => {
    const runner = readFileSync(resolve(process.cwd(), "scripts/run-vitest-files.ts"), "utf8");

    expect(runner).toContain(`resolve(testRoot, "e2e")`);
    expect(runner).toContain(`resolve(testRoot, "manual", "demo-screenshots")`);
    expect(runner).toContain("excludedDirectoryPaths.some");
  });

  it("expands requested directories into sequential file runs", () => {
    const runner = readFileSync(resolve(process.cwd(), "scripts/run-vitest-files.ts"), "utf8");

    expect(runner).toContain("function resolveRequestedPath");
    expect(runner).toContain("stat.isDirectory()");
    expect(runner).toContain("requestedFiles.flatMap(resolveRequestedPath)");
  });
});
