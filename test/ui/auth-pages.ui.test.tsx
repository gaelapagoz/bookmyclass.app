/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => {
  class MockAuthError extends Error {
    type: string;

    constructor(type: string) {
      super(type);
      this.type = type;
      this.name = "AuthError";
    }
  }

  return {
    AuthError: MockAuthError,
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: vi.fn(),
  };
});

import SignInPage from "../../src/app/(public)/sign-in/page";
import SignUpPage from "../../src/app/(public)/sign-up/page";
import ForgotPasswordPage from "../../src/app/(public)/forgot-password/page";
import { auth } from "../../src/auth";
import { redirect } from "next/navigation";

describe("Auth pages UI", () => {
  it("renders sign-up page", async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Sign Up" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeInTheDocument();
  });

  it("renders sign-in page", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Sign In" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
  });

  it("sign-in page sanitizes external callbackUrl for form and sign-up link", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ callbackUrl: "https://evil.example/path" }) }));

    const hiddenInput = document.querySelector('input[name="callbackUrl"]') as HTMLInputElement | null;
    expect(hiddenInput?.value).toBe("/dashboard");

    const signUpLink = screen.getByRole("link", { name: "Sign up" });
    expect(signUpLink).toHaveAttribute("href", "/sign-up?callbackUrl=%2Fdashboard");
  });

  it("sign-in page preserves safe internal callbackUrl for form and sign-up link", async () => {
    render(await SignInPage({ searchParams: Promise.resolve({ callbackUrl: "/dashboard/bookings" }) }));

    const hiddenInput = document.querySelector('input[name="callbackUrl"]') as HTMLInputElement | null;
    expect(hiddenInput?.value).toBe("/dashboard/bookings");

    const signUpLink = screen.getByRole("link", { name: "Sign up" });
    expect(signUpLink).toHaveAttribute("href", "/sign-up?callbackUrl=%2Fdashboard%2Fbookings");
  });

  it("renders public forgot-password page", async () => {
    render(await ForgotPasswordPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Forgot Password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Reset Link" })).toBeInTheDocument();
  });

  it("renders forgot-password success and failure state messages", async () => {
    render(await ForgotPasswordPage({ searchParams: Promise.resolve({ sent: "1" }) }));
    expect(screen.getByText("If an account exists for that email, a reset link has been sent.")).toBeInTheDocument();

    render(await ForgotPasswordPage({ searchParams: Promise.resolve({ error: "request_failed" }) }));
    expect(screen.getByText("Password reset is temporarily unavailable. Please try again shortly.")).toBeInTheDocument();
  });

  it("shows sign-up specific error messages", async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ error: "invalid_input" }) }));
    expect(
      screen.getByText("Please fill all fields correctly. Password must be at least 8 characters."),
    ).toBeInTheDocument();

    render(await SignUpPage({ searchParams: Promise.resolve({ error: "signup_failed" }) }));
    expect(screen.getByText("Could not create account right now. Please try again.")).toBeInTheDocument();

    render(await SignUpPage({ searchParams: Promise.resolve({ error: "disposable_email" }) }));
    expect(
      screen.getByText("Please use a non-temporary email address."),
    ).toBeInTheDocument();
  });

  it("sign-up page sanitizes external callbackUrl for authenticated users", async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: {
        id: "user_1",
        email: "client@example.com",
        name: "Client",
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    });

    await SignUpPage({
      searchParams: Promise.resolve({ callbackUrl: "https://evil.example/path" }),
    });

    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
