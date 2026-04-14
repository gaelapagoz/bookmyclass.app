/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: redirectMock,
  };
});

const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  withServerActionInstrumentation: async (
    _name: string,
    _options: { recordResponse?: boolean },
    callback: () => Promise<unknown>,
  ) => callback(),
  captureException: captureExceptionMock,
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.200",
    }),
  ),
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
}));

const { getAdminLoginAbuseStateMock, isAdminLoginCaptchaEnforcedMock } = vi.hoisted(() => ({
  getAdminLoginAbuseStateMock: vi.fn(async () => ({ isLocked: false, requiresCaptcha: false, retryAfterMs: null })),
  isAdminLoginCaptchaEnforcedMock: vi.fn(() => false),
}));

vi.mock("@/lib/auth/admin-login-abuse-service", () => ({
  getAdminLoginAbuseState: getAdminLoginAbuseStateMock,
  isAdminLoginCaptchaEnforced: isAdminLoginCaptchaEnforcedMock,
}));

const { getAdminLoginCaptchaSiteKeyMock } = vi.hoisted(() => ({
  getAdminLoginCaptchaSiteKeyMock: vi.fn(() => null),
}));

vi.mock("@/lib/auth/admin-login-captcha", () => ({
  getAdminLoginCaptchaSiteKey: getAdminLoginCaptchaSiteKeyMock,
}));

import { AuthError } from "next-auth";
import { auth, signIn } from "@/auth";
import AdminEntryPage, { adminSignInAction } from "../../src/app/admin/page";

describe("/admin entry flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue(null);
    getAdminLoginAbuseStateMock.mockResolvedValue({ isLocked: false, requiresCaptcha: false, retryAfterMs: null });
    isAdminLoginCaptchaEnforcedMock.mockReturnValue(false);
    getAdminLoginCaptchaSiteKeyMock.mockReturnValue(null);
  });

  it("unauthenticated user sees branded admin sign-in page", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    render(await AdminEntryPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Admin Portal")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Yoga Pilates Fitness Studio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In to Admin" })).toBeInTheDocument();
  });

  it("authenticated admin is redirected to /admin/dashboard", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "admin-1",
        name: "Admin",
        email: "admin@example.test",
        role: "ADMIN",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await expect(AdminEntryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/admin/dashboard",
    );
  });

  it("authenticated teacher is redirected to /teacher", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "teacher-1",
        name: "Teacher",
        email: "teacher@example.test",
        role: "TEACHER",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await expect(AdminEntryPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/teacher",
    );
  });

  it("authenticated non-staff sees access denied message", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: {
        id: "client-1",
        name: "Client",
        email: "client@example.test",
        role: "CLIENT",
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    render(await AdminEntryPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("does not have staff access", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign In to Admin" })).not.toBeInTheDocument();
  });

  it("adminSignInAction validates missing credentials", async () => {
    const formData = new FormData();
    formData.set("callbackUrl", "/admin/dashboard");

    await expect(adminSignInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin?error=invalid_input&callbackUrl=%2Fadmin%2Fdashboard",
    );
  });

  it("adminSignInAction maps credential auth error to invalid_credentials", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CredentialsSignin"));

    const formData = new FormData();
    formData.set("email", "admin@example.test");
    formData.set("password", "wrong-password");
    formData.set("callbackUrl", "/admin/dashboard");

    await expect(adminSignInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin?error=invalid_credentials&callbackUrl=%2Fadmin%2Fdashboard",
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("adminSignInAction reports unexpected auth errors", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CallbackRouteError"));

    const formData = new FormData();
    formData.set("email", "admin@example.test");
    formData.set("password", "wrong-password");
    formData.set("callbackUrl", "/admin/dashboard");

    await expect(adminSignInAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/admin?error=auth_failed&callbackUrl=%2Fadmin%2Fdashboard",
    );
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it("adminSignInAction submits credentials on valid input", async () => {
    vi.mocked(signIn).mockResolvedValue(undefined as never);

    const formData = new FormData();
    formData.set("email", "admin@example.test");
    formData.set("password", "very-secure-password");
    formData.set("callbackUrl", "/admin/dashboard");

    await adminSignInAction(formData);

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "admin@example.test",
      password: "very-secure-password",
      authFlow: "admin",
      captchaToken: undefined,
      redirectTo: "/admin",
    });
  });

  it("renders captcha challenge when backend marks request as suspicious", async () => {
    getAdminLoginCaptchaSiteKeyMock.mockReturnValue("site-key");

    render(
      await AdminEntryPage({
        searchParams: Promise.resolve({
          error: "invalid_credentials",
          guard: "captcha_required",
        }),
      }),
    );

    expect(screen.getByText("Complete the verification challenge", { exact: false })).toBeInTheDocument();
    expect(document.querySelector(".cf-turnstile")).not.toBeNull();
  });
});
