import "./helpers/setup-env";
import { beforeEach, describe, expect, it } from "vitest";

import { getDashboardTrendData } from "../../src/lib/admin/admin-analytics-service";
import { resetDb } from "./helpers/reset-db";

function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("dashboard trend data", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns the requested daily window and ends on today", async () => {
    const last7 = await getDashboardTrendData("last7Days");
    const last30 = await getDashboardTrendData("last30Days");
    const last90 = await getDashboardTrendData("last90Days");

    expect(last7).toHaveLength(7);
    expect(last30).toHaveLength(30);
    expect(last90).toHaveLength(90);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toDayKey(today);
    expect(last7[last7.length - 1]?.date).toBe(todayKey);
    expect(last30[last30.length - 1]?.date).toBe(todayKey);
    expect(last90[last90.length - 1]?.date).toBe(todayKey);
  });

  it("keeps the 90-day window as consecutive daily points", async () => {
    const last90 = await getDashboardTrendData("last90Days");

    for (let index = 1; index < last90.length; index += 1) {
      const previous = new Date(`${last90[index - 1]?.date}T00:00:00.000Z`);
      const current = new Date(`${last90[index]?.date}T00:00:00.000Z`);
      const diffDays = Math.round((current.getTime() - previous.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(1);
    }
  });
});
