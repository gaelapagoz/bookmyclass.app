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
      create: vi.fn(),
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

  it("renders public forgot-password page", async () => {
    render(await ForgotPasswordPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Forgot Password" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Reset Link" })).toBeInTheDocument();
  });

  it("shows sign-up specific error messages", async () => {
    render(await SignUpPage({ searchParams: Promise.resolve({ error: "invalid_input" }) }));
    expect(
      screen.getByText("Please fill all fields correctly. Password must be at least 8 characters."),
    ).toBeInTheDocument();

    render(await SignUpPage({ searchParams: Promise.resolve({ error: "email_exists" }) }));
    expect(screen.getByText("An account with this email already exists.")).toBeInTheDocument();

    render(await SignUpPage({ searchParams: Promise.resolve({ error: "signup_failed" }) }));
    expect(screen.getByText("Could not create account right now. Please try again.")).toBeInTheDocument();

    render(await SignUpPage({ searchParams: Promise.resolve({ error: "signin_failed" }) }));
    expect(
      screen.getByText("Account created, but automatic sign-in failed. Please sign in manually."),
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
