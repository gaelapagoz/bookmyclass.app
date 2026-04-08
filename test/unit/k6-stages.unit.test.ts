import { describe, expect, it } from "vitest";
import { buildArrivalConfig } from "../../k6/config/stages.js";

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
});
