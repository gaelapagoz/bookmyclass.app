import { UserActivationStatus } from "@prisma/client";
import { AuthError } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("@sentry/nextjs", () => ({
  withServerActionInstrumentation: async (
    _name: string,
    _options: { recordResponse?: boolean },
    callback: () => Promise<unknown>,
  ) => callback(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/security/csrf-token", () => ({
  assertValidCsrfToken: vi.fn(async () => undefined),
  createCsrfToken: vi.fn(async () => "csrf-token"),
  getCsrfFieldName: vi.fn(() => "csrfToken"),
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

const { getSignInEligibilityUserByEmailMock } = vi.hoisted(() => ({
  getSignInEligibilityUserByEmailMock: vi.fn(),
}));

vi.mock("@/lib/auth/sign-in-service", () => ({
  getSignInEligibilityUserByEmail: getSignInEligibilityUserByEmailMock,
}));

const { signInMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: signInMock,
}));

import { signInAction } from "../../src/app/(public)/sign-in/page";

describe("signInAction callback passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards valid internal callbackUrl to signIn unchanged", async () => {
    getSignInEligibilityUserByEmailMock.mockResolvedValue({
      role: "CLIENT",
      emailVerified: new Date(),
      activationStatus: UserActivationStatus.ACTIVE,
    });
    signInMock.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("email", "client@example.test");
    formData.set("password", "password-123");
    formData.set("callbackUrl", "/book-a-class/yoga-class");

    await signInAction(formData);

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/book-a-class/yoga-class" }),
    );
  });

  it("redirects ADMIN to /admin when no callbackUrl is provided", async () => {
    getSignInEligibilityUserByEmailMock.mockResolvedValue({
      role: "ADMIN",
      emailVerified: new Date(),
      activationStatus: UserActivationStatus.ACTIVE,
    });
    signInMock.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("email", "admin@example.test");
    formData.set("password", "password-123");

    await signInAction(formData);

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/admin" }),
    );
  });

  it("redirects TEACHER to /teacher when no callbackUrl is provided", async () => {
    getSignInEligibilityUserByEmailMock.mockResolvedValue({
      role: "TEACHER",
      emailVerified: new Date(),
      activationStatus: UserActivationStatus.ACTIVE,
    });
    signInMock.mockResolvedValue(undefined);

    const formData = new FormData();
    formData.set("email", "teacher@example.test");
    formData.set("password", "password-123");

    await signInAction(formData);

    expect(signInMock).toHaveBeenCalledWith(
      "credentials",
      expect.objectContaining({ redirectTo: "/teacher" }),
    );
  });
});

describe("signInAction callback sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSignInEligibilityUserByEmailMock.mockResolvedValue(null);
  });

  it("sanitizes callbackUrl on missing credential redirects", async () => {
    const formData = new FormData();
    formData.set("callbackUrl", "http://localhost:3000/dashboard");

    await expect(signInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?error=invalid_input&callbackUrl=%2Fdashboard",
    );
  });

  it("sanitizes callbackUrl on email verification redirects", async () => {
    getSignInEligibilityUserByEmailMock.mockResolvedValue({
      role: "CLIENT",
      emailVerified: null,
      activationStatus: UserActivationStatus.PENDING,
    });

    const formData = new FormData();
    formData.set("email", "client@example.test");
    formData.set("password", "password-123");
    formData.set("callbackUrl", "/sign-in?callbackUrl=http%3A%2F%2F127.0.0.1%3A3000%2Fdashboard");

    await expect(signInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?error=email_not_verified&email=client%40example.test&callbackUrl=%2Fdashboard",
    );
  });

  it("sanitizes callbackUrl on auth error redirects", async () => {
    signInMock.mockRejectedValue(new AuthError("CredentialsSignin"));

    const formData = new FormData();
    formData.set("email", "client@example.test");
    formData.set("password", "wrong-password");
    formData.set("callbackUrl", "/sign-in?callbackUrl=http%3A%2F%2F%5B%3A%3A1%5D%3A3000%2Fdashboard");

    await expect(signInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/sign-in?error=invalid_credentials&callbackUrl=%2Fdashboard",
    );
  });
});
