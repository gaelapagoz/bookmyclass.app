import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { AuthError } from "next-auth";
import { Role, UserActivationStatus, UserCreatedVia } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth, signIn } from "@/auth";
import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";
import VerifyEmailPage from "../../src/app/(public)/verify-email/page";
import { signInAction } from "../../src/app/(public)/sign-in/page";
import { registerAction } from "../../src/app/(public)/sign-up/page";
import { requireAuth } from "../../src/lib/auth/require-auth";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

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

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

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

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
}));

function makeSignUpForm(input: {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  role?: string;
}) {
  const form = new FormData();
  form.set("firstName", input.firstName ?? "Ava");
  form.set("lastName", input.lastName ?? "Client");
  form.set("email", input.email ?? `ava.${Date.now()}@example.test`);
  form.set("password", input.password ?? "Password123!");
  if (input.role) {
    form.set("role", input.role);
  }
  return form;
}

function makeSignInForm(input: { email?: string; password?: string; callbackUrl?: string }) {
  const form = new FormData();
  form.set("email", input.email ?? "client@example.test");
  form.set("password", input.password ?? "Password123!");
  form.set("callbackUrl", input.callbackUrl ?? "/dashboard");
  return form;
}

function extractRegistrationTokenFromCapturedEmail(email: string): string {
  const message = [...getCapturedTestEmails()]
    .reverse()
    .find((item) => item.context === "user-identity-verification" && item.to.includes(email.toLowerCase()));

  if (!message) {
    throw new Error("Expected verification email in test outbox.");
  }

  const tokenMatch = message.html.match(/registrationToken=([^"&]+)/);
  if (!tokenMatch?.[1]) {
    throw new Error("Registration token not found in captured email payload.");
  }

  return decodeURIComponent(tokenMatch[1]);
}

describe("auth actions integration", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(signIn).mockReset();
    vi.mocked(auth).mockResolvedValue(null);
    captureExceptionMock.mockReset();
    clearCapturedTestEmails();

    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    process.env.APP_URL = process.env.APP_URL || "http://localhost:3000";
  });

  it("sign-up invalid input is rejected", async () => {
    await expect(
      registerAction(makeSignUpForm({ lastName: "", password: "short" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-up?error=invalid_input");
  });

  it("signup creates pending registration (not active user) and redirects to verification flow", async () => {
    const email = `new.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    const createdUser = await prisma.user.findUnique({ where: { email } });
    expect(createdUser).toBeNull();

    const pending = await prisma.pendingUserRegistration.findUnique({ where: { email } });
    expect(pending).not.toBeNull();
    expect(pending?.consumedAt).toBeNull();
    expect(getCapturedTestEmails()).toHaveLength(1);
  });

  it("signup never allows public role escalation", async () => {
    const email = `role-escalation.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email, role: "ADMIN" }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    const token = extractRegistrationTokenFromCapturedEmail(email);

    await expect(
      VerifyEmailPage({
        searchParams: Promise.resolve({ email, registrationToken: token }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/verify-email?verified=1&email=${encodeURIComponent(email)}`);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: { role: true, activationStatus: true, createdVia: true },
    });

    expect(created.role).toBe(Role.CLIENT);
    expect(created.activationStatus).toBe(UserActivationStatus.ACTIVE);
    expect(created.createdVia).toBe(UserCreatedVia.PUBLIC_SIGNUP);
  });

  it("verification activates pending registration exactly once", async () => {
    const email = `verify.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    const token = extractRegistrationTokenFromCapturedEmail(email);

    await expect(
      VerifyEmailPage({
        searchParams: Promise.resolve({ email, registrationToken: token }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/verify-email?verified=1&email=${encodeURIComponent(email)}`);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email },
      select: {
        emailVerified: true,
        emailVerifiedAt: true,
        activationStatus: true,
        createdVia: true,
      },
    });

    expect(created.emailVerified).not.toBeNull();
    expect(created.emailVerifiedAt).not.toBeNull();
    expect(created.activationStatus).toBe(UserActivationStatus.ACTIVE);
    expect(created.createdVia).toBe(UserCreatedVia.PUBLIC_SIGNUP);

    await expect(
      VerifyEmailPage({
        searchParams: Promise.resolve({ email, registrationToken: token }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/verify-email?error=invalid_token&email=${encodeURIComponent(email)}`);
  });

  it("expired registration token fails", async () => {
    const email = `expired.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    await prisma.pendingUserRegistration.update({
      where: { email },
      data: {
        tokenExpiresAt: new Date(Date.now() - 1_000),
      },
    });

    const token = extractRegistrationTokenFromCapturedEmail(email);

    await expect(
      VerifyEmailPage({
        searchParams: Promise.resolve({ email, registrationToken: token }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/verify-email?error=invalid_token&email=${encodeURIComponent(email)}`);
  });

  it("unverified user cannot sign in normally", async () => {
    const email = `unverified.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Unverified User",
        firstName: "Unverified",
        lastName: "User",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
        emailVerifiedAt: null,
        activationStatus: UserActivationStatus.PENDING,
      },
    });

    await expect(signInAction(makeSignInForm({ email, password: "Password123!" }))).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?error=email_not_verified&email=${encodeURIComponent(email)}&callbackUrl=%2Fdashboard`,
    );

    expect(vi.mocked(signIn)).not.toHaveBeenCalled();
  });

  it("verified user can sign in", async () => {
    const email = `verified.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Verified User",
        firstName: "Verified",
        lastName: "User",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
        activationStatus: UserActivationStatus.ACTIVE,
      },
    });

    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      expect(_provider).toBe("credentials");
      expect((options as { email?: string }).email).toBe(email);
      const error = new Error("NEXT_REDIRECT:/dashboard");
      (error as Error & { digest?: string }).digest = "NEXT_REDIRECT;replace;/dashboard;307;";
      throw error;
    });

    await expect(signInAction(makeSignInForm({ email, password: "Password123!" }))).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard",
    );
  });

  it("verified user can access protected routes", async () => {
    const email = `access.${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: "Access User",
        firstName: "Access",
        lastName: "User",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
        emailVerifiedAt: new Date(),
        activationStatus: UserActivationStatus.ACTIVE,
      },
      select: { id: true },
    });

    const session = {
      user: {
        id: user.id,
        email,
        name: "Access User",
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    };

    vi.mocked(auth).mockResolvedValue(session as never);

    const result = await requireAuth();
    expect(result).toEqual(session);
  });

  it("sign-in action rejects invalid credentials", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CredentialsSignin"));

    await expect(
      signInAction(makeSignInForm({ email: "bad@example.test", password: "wrong" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?error=invalid_credentials&callbackUrl=%2Fdashboard");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("sign-in action reports unexpected auth errors", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CallbackRouteError"));

    await expect(
      signInAction(makeSignInForm({ email: "valid@example.test", password: "Password123!" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?error=auth_failed&callbackUrl=%2Fdashboard");
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
