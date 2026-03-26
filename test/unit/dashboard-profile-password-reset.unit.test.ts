import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  getDashboardProfileData: vi.fn(),
}));

vi.mock("@/lib/auth/password-service", () => ({
  requestPasswordReset: vi.fn(),
}));

import { getDashboardProfileData } from "@/lib/dashboard/dashboard-service";
import { requestPasswordReset } from "@/lib/auth/password-service";
import { requestDashboardPasswordResetByUserId } from "../../src/lib/dashboard/dashboard-password-reset";

describe("requestDashboardPasswordResetByUserId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses requestPasswordReset with authenticated user email", async () => {
    vi.mocked(getDashboardProfileData).mockResolvedValue({
      firstName: "Client",
      lastName: "User",
      fullName: "Client User",
      email: "client@example.test",
      phone: "",
    });
    vi.mocked(requestPasswordReset).mockResolvedValue({ accepted: true });

    await requestDashboardPasswordResetByUserId({
      userId: "client-1",
      appUrl: "http://localhost:3000",
    });

    expect(getDashboardProfileData).toHaveBeenCalledWith("client-1");
    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: "client@example.test",
      appUrl: "http://localhost:3000",
    });
  });
});
