import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("deploy seed chain contract", () => {
  it("uses staging seed command and removes legacy staging predecessor seed command", () => {
    const scriptPath = path.resolve(process.cwd(), "scripts/deploy-server-tag.sh");
    const content = readFileSync(scriptPath, "utf8");
    const legacySeedMode = ["uat", "performance"].join("-");

    expect(content).toContain("npm run db:seed:staging");
    expect(content).not.toContain(`npm run db:seed:${legacySeedMode}`);
  });

  it("documents canonical destructive reseed chain in UAT performance runbook", () => {
    const runbookPath = path.resolve(process.cwd(), "docs/50_12_uat_performance_operator_runbook.md");
    const content = readFileSync(runbookPath, "utf8");

    expect(content).toContain("npm run db:seed:prod");
    expect(content).toContain("npm run db:seed:staging");
    expect(content).toContain("npm run db:seed:uat:k6");
    expect(content).not.toContain("npm run prisma:seed");
    expect(content).not.toContain("npm run db:seed:server:k6");
  });
});
