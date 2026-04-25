import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("UAT perf operator script contract", () => {
  it("uses UAT app directory defaults and includes dev deps during deploy/reset build path", () => {
    const resetScript = readRepoFile("scripts/uat-reset-and-verify.sh");
    const deployScript = readRepoFile("scripts/uat-deploy-tag.sh");

    expect(resetScript).toContain('APP_DIR="${APP_DIR:-/var/www/bookmyclass-uat}"');
    expect(deployScript).toContain('APP_DIR="${APP_DIR:-/var/www/bookmyclass-uat}"');
    expect(resetScript).toContain("npm ci --include=dev");
    expect(deployScript).toContain("npm ci --include=dev");
  });

  it("keeps seed checkout-readiness guard by setting and verifying synced Stripe status for catalog prices", () => {
    const devSeed = readRepoFile("prisma/seed/modes/development.ts");
    const perfSeed = readRepoFile("prisma/seed/modes/uat-performance.ts");

    expect(devSeed).toContain("const stripeSyncStatus = hasStripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING;");
    expect(perfSeed).toContain("const stripeSyncStatus = hasStripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING;");

    // Stripe sync verification for catalog prices should exist in dev seed.
    expect(devSeed).toContain("stripeSyncStatus: true");
    expect(devSeed).toContain("non-SYNCED prices");
  });
});
