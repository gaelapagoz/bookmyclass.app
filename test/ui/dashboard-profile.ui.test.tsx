/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  DashboardServiceError: class DashboardServiceError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  getDashboardProfileData: vi.fn(),
  updateDashboardProfile: vi.fn(),
}));

vi.mock("@/lib/auth/password-service", () => ({
  PasswordServiceError: class PasswordServiceError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  changeAuthenticatedUserPassword: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardProfileData } from "@/lib/dashboard/dashboard-service";
import DashboardProfilePage from "../../src/app/(protected)/dashboard/profile/page";

describe("DashboardProfilePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireAuth).mockResolvedValue({ user: { id: "client-1" } } as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(getDashboardProfileData).mockResolvedValue({
      firstName: "Client",
      lastName: "User",
      fullName: "Client User",
      email: "client@example.test",
      phone: "",
    });
  });

  it("renders account, change password, and forgot-password trigger in My Profile", async () => {
    render(await DashboardProfilePage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "My Profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account Details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Forgot password?" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Save Profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update Password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Password Reset Email" })).toBeInTheDocument();
  });
});
