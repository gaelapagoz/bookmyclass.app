import { describe, expect, it } from "vitest";
import {
  buildArrivalConfig,
  buildScenarioStages,
  getSupportedStageProfiles,
  resolveStageProfile,
} from "../../k6/config/stages.js";

function totalMinutes(stages: Array<{ duration: string }>) {
  return stages.reduce((total, stage) => {
    const match = /^(\d+)m$/.exec(stage.duration);
    if (!match) {
      throw new Error(`Unsupported duration format in test: ${stage.duration}`);
    }
    return total + Number(match[1]);
  }, 0);
}

describe("k6 stage config", () => {
  it("keeps default second-based booking rates for non-booking scenario sets", () => {
    const config = buildArrivalConfig("smoke_booking_safe", "booking_checkout", {
      scenarioSet: "non_booking_smoke",
    });

    expect(config.timeUnit).toBe("1s");
    expect(config.startRate).toBe(1);
    expect(config.stages).toEqual([
      { duration: "1m", target: 1 },
      { duration: "3m", target: 1 },
      { duration: "1m", target: 0 },
    ]);
  });

  it("uses minute-based booking-safe rates for booking_only_smoke", () => {
    const config = buildArrivalConfig("smoke_booking_safe", "booking_checkout", {
      scenarioSet: "booking_only_smoke",
    });

    expect(config.timeUnit).toBe("1m");
    expect(config.startRate).toBe(1);
    expect(config.stages).toEqual([
      { duration: "1m", target: 2 },
      { duration: "3m", target: 4 },
      { duration: "1m", target: 0 },
    ]);
  });

  it("enforces 5-minute total stages for t50", () => {
    const stages = buildScenarioStages("t50", "booking_checkout");
    expect(stages).toEqual([
      { duration: "1m", target: 5 },
      { duration: "3m", target: 8 },
      { duration: "1m", target: 0 },
    ]);
    expect(totalMinutes(stages)).toBe(5);
  });

  it("enforces 20-minute total stages for t100", () => {
    const stages = buildScenarioStages("t100", "booking_checkout");
    expect(stages).toEqual([
      { duration: "5m", target: 9 },
      { duration: "10m", target: 15 },
      { duration: "5m", target: 0 },
    ]);
    expect(totalMinutes(stages)).toBe(20);
  });

  it("maps legacy profiles to deprecated t100 alias behavior", () => {
    const canonical = buildScenarioStages("t100", "booking_checkout");
    expect(buildScenarioStages("t100_5m", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("t250", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("t250_5m", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("t500", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("t750", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("t1000", "booking_checkout")).toEqual(canonical);
    expect(buildScenarioStages("soak1000", "booking_checkout")).toEqual(canonical);
  });

  it("resolves supported profiles and rejects unsupported ones clearly", () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {};
    expect(resolveStageProfile()).toBe("smoke");

    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = { STAGE_PROFILE: "t50" };
    expect(resolveStageProfile()).toBe("t50");

    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = { STAGE_PROFILE: "t250" };
    expect(resolveStageProfile()).toBe("t100");

    expect(getSupportedStageProfiles()).toEqual(
      expect.arrayContaining(["smoke", "smoke_booking_safe", "t50", "t100", "t250", "t500", "t750", "t1000"]),
    );

    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = { STAGE_PROFILE: "not_a_profile" };
    expect(() => resolveStageProfile()).toThrowError(/Unsupported STAGE_PROFILE='not_a_profile'/);
  });
});
