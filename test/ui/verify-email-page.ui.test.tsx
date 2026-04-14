/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/email-verification-service", () => ({
  requestEmailVerification: vi.fn(),
  verifyEmailByToken: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: vi.fn(),
  };
});

import VerifyEmailPage from "../../src/app/(public)/verify-email/page";

describe("Verify email page UI states", () => {
  it("success state hides resend form and shows primary sign-in CTA", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          verified: "1",
          email: "verified@example.test",
        }),
      }),
    );

    expect(screen.getByText("Email verified. You can now sign in.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue to Sign In" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend Verification Email" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });

  it("invalid or expired token state shows resend form", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          error: "invalid_token",
          email: "user@example.test",
        }),
      }),
    );

    expect(screen.getByText("Verification link is invalid or expired.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend Verification Email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("missing token state shows resend form", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          email: "user@example.test",
        }),
      }),
    );

    expect(screen.getByRole("button", { name: "Resend Verification Email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows blocked, rate-limited, and send-failed messages", async () => {
    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          blocked: "1",
          email: "user@example.test",
        }),
      }),
    );
    expect(screen.getByText("Please verify your email before accessing the dashboard.")).toBeInTheDocument();

    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          error: "rate_limited",
          email: "user@example.test",
        }),
      }),
    );
    expect(screen.getByText("Please wait before requesting another verification email.")).toBeInTheDocument();

    render(
      await VerifyEmailPage({
        searchParams: Promise.resolve({
          error: "send_failed",
          email: "user@example.test",
        }),
      }),
    );
    expect(screen.getByText("Could not send verification email right now.")).toBeInTheDocument();
  });
});
