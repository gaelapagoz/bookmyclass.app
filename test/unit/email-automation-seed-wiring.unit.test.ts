import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("email automation seed wiring", () => {
  it("pauses expected automations in staging and development seeds", () => {
    const stagingSeed = readRepoFile("prisma/seed/modes/staging.ts");
    const developmentSeed = readRepoFile("prisma/seed/modes/development.ts");

    expect(stagingSeed).toContain("ensureAllExpectedAutomationTemplatesHaveStatus(false)");
    expect(developmentSeed).toContain("ensureAllExpectedAutomationTemplatesHaveStatus(false)");
  });

  it("clears persisted automation templates before reseeding", () => {
    const stagingSeed = readRepoFile("prisma/seed/modes/staging.ts");
    const developmentSeed = readRepoFile("prisma/seed/modes/development.ts");
    const e2eSeed = readRepoFile("scripts/e2e-server-seed.ts");

    expect(stagingSeed).toContain("await prisma.emailTemplate.deleteMany();");
    expect(stagingSeed).toContain("await prisma.emailAutomationEvent.deleteMany();");
    expect(developmentSeed).toContain("await prisma.emailTemplate.deleteMany();");
    expect(developmentSeed).toContain("await prisma.emailAutomationEvent.deleteMany();");
    expect(e2eSeed).toContain("await prisma.emailTemplate.deleteMany();");
    expect(e2eSeed).toContain("await prisma.emailAutomationEvent.deleteMany();");
  });

  it("reactivates expected automations for deterministic e2e seed flows", () => {
    const e2eSeed = readRepoFile("scripts/e2e-server-seed.ts");

    expect(e2eSeed).toContain("ensureAllExpectedAutomationTemplatesHaveStatus(true)");
  });

  it("re-seeds the loyalty baseline after loyalty tables are purged", () => {
    const stagingSeed = readRepoFile("prisma/seed/modes/staging.ts");
    const developmentSeed = readRepoFile("prisma/seed/modes/development.ts");
    const e2eSeed = readRepoFile("scripts/e2e-server-seed.ts");

    expect(stagingSeed).toContain("await prisma.loyaltyProgram.deleteMany();");
    expect(stagingSeed).toContain("await seedLoyaltyProgram();");
    expect(developmentSeed).toContain("await prisma.loyaltyProgram.deleteMany();");
    expect(developmentSeed).toContain("await seedLoyaltyProgram();");
    expect(e2eSeed).toContain("await prisma.loyaltyProgram.deleteMany();");
    expect(e2eSeed).toContain("await seedLoyaltyProgram();");
  });
});
