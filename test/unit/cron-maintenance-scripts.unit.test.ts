import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("cron maintenance scripts", () => {
  it("makes the installed maintenance cron fail when the route reports ok false", () => {
    const script = readFileSync("scripts/cron-server-install-services.sh", "utf8");

    expect(script).toContain("response=\\$(curl -fsS");
    expect(script).toContain("grep -q '\\\"ok\\\":true'");
  });

  it("makes cron verification fail when the route reports ok false", () => {
    const script = readFileSync("scripts/cron-server-verify-services.sh", "utf8");

    expect(script).toContain("maintenance_response=\"$(");
    expect(script).toContain("grep -q '\"ok\":true'");
    expect(script).toContain("response=$maintenance_response");
  });
});
