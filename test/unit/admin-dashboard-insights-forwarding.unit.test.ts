import { describe, expect, it, vi } from "vitest";

const { getAdminDashboardInsightsMock } = vi.hoisted(() => ({
  getAdminDashboardInsightsMock: vi.fn(),
}));

vi.mock("@/lib/admin/admin-analytics-service", () => ({
  getAdminDashboardInsights: getAdminDashboardInsightsMock,
}));

import { getAdminDashboardInsights } from "@/lib/admin/admin-analytics-service";

describe("admin-service dashboard insights delegation", () => {
  it("delegates to admin analytics service without altering payload", async () => {
    const payload = {
      topClassSessions: [],
      topClients: [],
      atRiskClients: [],
      staffPerformance: [],
    };

    getAdminDashboardInsightsMock.mockResolvedValueOnce(payload);

    const result = await getAdminDashboardInsights("last30Days");

    expect(getAdminDashboardInsightsMock).toHaveBeenCalledWith("last30Days");
    expect(result).toEqual(payload);
  });
});

