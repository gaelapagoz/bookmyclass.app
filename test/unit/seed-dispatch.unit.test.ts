import { describe, expect, it } from "vitest";

import { runSeedForMode, seedModeRunners } from "../../prisma/seed";

describe("seed mode dispatch", () => {
  it("exposes canonical mode runners", () => {
    expect(Object.keys(seedModeRunners).sort()).toEqual(["demo", "development", "production", "staging"]);
  });

  it("dispatches to the selected runner", async () => {
    const calls: string[] = [];
    const originalStagingRunner = seedModeRunners.staging;

    seedModeRunners.staging = async () => {
      calls.push("staging");
    };

    try {
      await runSeedForMode("staging");
      expect(calls).toEqual(["staging"]);
    } finally {
      seedModeRunners.staging = originalStagingRunner;
    }
  });
});

