import { describe, expect, it } from "vitest";

import { validate } from "../../scripts/verify-dashboard-trend-seed-db";

describe("verify-dashboard-trend-seed-db rollover", () => {
  it("uses the seeded reference day instead of wall-clock today", () => {
    const coverage = {
      sessionDays: 100,
      orderDays: 100,
      paymentDays: 100,
      bookingDays: 100,
      cancellationDays: 100,
      earliestSessionDay: "2026-01-01",
      latestSessionDay: "2026-04-10",
      sessionDaysLast7: 7,
      sessionDaysLast30: 30,
      sessionDaysLast90: 90,
      referenceDay: "2026-04-10",
    };

    expect(validate(coverage)).toEqual([]);
  });
});
