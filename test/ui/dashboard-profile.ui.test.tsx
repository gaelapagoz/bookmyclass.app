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

  it("shows explicit reset delivery failure message", async () => {
    render(
      await DashboardProfilePage({
        searchParams: Promise.resolve({ reset_error: "send_failed" }),
      }),
    );

    expect(screen.getByText("Could not send password reset email right now.")).toBeInTheDocument();
  });

  it("renders profile and password success/error messaging branches", async () => {
    render(
      await DashboardProfilePage({
        searchParams: Promise.resolve({
          profile_saved: "1",
          password_saved: "1",
          reset_sent: "1",
        }),
      }),
    );

    expect(screen.getByText("Profile updated successfully.")).toBeInTheDocument();
    expect(screen.getByText("Password updated successfully.")).toBeInTheDocument();
    expect(screen.getByText("Password reset email sent. Check your inbox for the reset link.")).toBeInTheDocument();

    render(
      await DashboardProfilePage({
        searchParams: Promise.resolve({
          profile_error: "email_exists",
          password_error: "password_mismatch",
        }),
      }),
    );

    expect(screen.getByText("This email is already used by another account.")).toBeInTheDocument();
    expect(screen.getByText("New password and confirmation do not match.")).toBeInTheDocument();
  });
});
