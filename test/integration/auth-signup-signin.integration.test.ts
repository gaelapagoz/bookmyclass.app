import "./helpers/setup-env";

import { hash } from "bcryptjs";
import { AuthError } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
}));

import { auth, signIn } from "@/auth";
import VerifyEmailPage from "../../src/app/(public)/verify-email/page";
import { signInAction } from "../../src/app/(public)/sign-in/page";
import { registerAction } from "../../src/app/(public)/sign-up/page";
import { requireAuth } from "../../src/lib/auth/require-auth";

function makeSignUpForm(input: {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
}) {
  const form = new FormData();
  form.set("firstName", input.firstName ?? "Ava");
  form.set("lastName", input.lastName ?? "Client");
  form.set("email", input.email ?? `ava.${Date.now()}@example.test`);
  form.set("password", input.password ?? "Password123!");
  return form;
}

function makeSignInForm(input: { email?: string; password?: string; callbackUrl?: string }) {
  const form = new FormData();
  form.set("email", input.email ?? "client@example.test");
  form.set("password", input.password ?? "Password123!");
  form.set("callbackUrl", input.callbackUrl ?? "/dashboard");
  return form;
}

function getRedirectUrlFromError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = "NEXT_REDIRECT:";
  const index = message.indexOf(prefix);
  return index >= 0 ? message.slice(index + prefix.length) : message;
}

function extractVerificationTokenFromResendCall(fetchMock: ReturnType<typeof vi.fn>): string {
  const firstCall = fetchMock.mock.calls[0];
  if (!firstCall) {
    throw new Error("Expected verification email call.");
  }

  const payload = JSON.parse(String((firstCall[1] as { body?: unknown })?.body ?? "{}")) as {
    html?: string;
  };
  const html = payload.html ?? "";
  const tokenMatch = html.match(/token=([^"&]+)/);
  if (!tokenMatch?.[1]) {
    throw new Error("Verification token not found in email payload.");
  }

  return decodeURIComponent(tokenMatch[1]);
}

describe("auth actions integration", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDb();
    vi.mocked(signIn).mockReset();
    vi.mocked(auth).mockResolvedValue(null);

    process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";
    process.env.EMAIL_FROM = process.env.EMAIL_FROM || "Test <test@example.test>";
    process.env.APP_URL = process.env.APP_URL || "http://localhost:3000";

    fetchMock = vi.fn(async () =>
      Response.json({ id: "email_1" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sign-up invalid input is rejected", async () => {
    await expect(
      registerAction(makeSignUpForm({ lastName: "", password: "short" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-up?error=invalid_input");
  });

  it("signup creates an unverified user and redirects to verification flow", async () => {
    const email = `new.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    expect(created?.passwordHash).toBeTruthy();
    expect(created?.emailVerified).toBeNull();

    const verificationRow = await prisma.verificationToken.findFirst({
      where: { identifier: email },
    });
    expect(verificationRow).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(signIn)).not.toHaveBeenCalled();
  });

  it("duplicate verified email shows expected error", async () => {
    await prisma.user.create({
      data: {
        name: "Existing User",
        firstName: "Existing",
        lastName: "User",
        email: "existing@example.test",
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
      },
    });

    await expect(
      registerAction(makeSignUpForm({ email: "existing@example.test" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-up?error=email_exists");
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
      },
    });

    await expect(signInAction(makeSignInForm({ email, password: "Password123!" }))).rejects.toThrow(
      `NEXT_REDIRECT:/sign-in?error=email_not_verified&email=${encodeURIComponent(email)}&callbackUrl=%2Fdashboard`,
    );

    expect(vi.mocked(signIn)).not.toHaveBeenCalled();
  });

  it("unverified user cannot access protected routes", async () => {
    const email = `blocked.${Date.now()}@example.test`;
    const user = await prisma.user.create({
      data: {
        name: "Blocked User",
        firstName: "Blocked",
        lastName: "User",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
      select: { id: true },
    });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: user.id,
        email,
        name: "Blocked User",
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as never);

    await expect(requireAuth()).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?blocked=1&email=${encodeURIComponent(email)}`,
    );
  });

  it("verification flow marks user as verified", async () => {
    const email = `verify.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      `NEXT_REDIRECT:/verify-email?sent=1&email=${encodeURIComponent(email)}`,
    );

    const token = extractVerificationTokenFromResendCall(fetchMock);

    await expect(
      VerifyEmailPage({
        searchParams: Promise.resolve({ email, token }),
      }),
    ).rejects.toThrow(`NEXT_REDIRECT:/verify-email?verified=1&email=${encodeURIComponent(email)}`);

    const updated = await prisma.user.findUnique({
      where: { email },
      select: { emailVerified: true },
    });
    expect(updated?.emailVerified).not.toBeNull();
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
  });

  it("sign-in action sanitizes protocol-relative callback URL to /dashboard", async () => {
    await prisma.user.create({
      data: {
        name: "Callback User",
        firstName: "Callback",
        lastName: "User",
        email: "ok@example.test",
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
      },
    });

    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      expect((options as { redirectTo?: string }).redirectTo).toBe("/dashboard");
      const error = new Error("NEXT_REDIRECT:/dashboard");
      (error as Error & { digest?: string }).digest = "NEXT_REDIRECT;replace;/dashboard;307;";
      throw error;
    });

    await expect(
      signInAction(
        makeSignInForm({
          email: "ok@example.test",
          password: "Password123!",
          callbackUrl: "//evil.com",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("sign-in action preserves safe internal callback URL", async () => {
    await prisma.user.create({
      data: {
        name: "Callback User",
        firstName: "Callback",
        lastName: "User",
        email: "ok2@example.test",
        passwordHash: await hash("Password123!", 12),
        emailVerified: new Date(),
      },
    });

    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      expect((options as { redirectTo?: string }).redirectTo).toBe("/dashboard/bookings");
      const error = new Error("NEXT_REDIRECT:/dashboard/bookings");
      (error as Error & { digest?: string }).digest = "NEXT_REDIRECT;replace;/dashboard/bookings;307;";
      throw error;
    });

    await expect(
      signInAction(
        makeSignInForm({
          email: "ok2@example.test",
          password: "Password123!",
          callbackUrl: "/dashboard/bookings",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/bookings");
  });

  it("verify-email route redirects with invalid_token for bad token", async () => {
    const email = `invalid-token.${Date.now()}@example.test`;
    await prisma.user.create({
      data: {
        name: "Token User",
        firstName: "Token",
        lastName: "User",
        email,
        passwordHash: await hash("Password123!", 12),
        emailVerified: null,
      },
    });

    try {
      await VerifyEmailPage({
        searchParams: Promise.resolve({ email, token: "bad-token" }),
      });
      throw new Error("Expected redirect");
    } catch (error) {
      const redirectUrl = getRedirectUrlFromError(error);
      expect(redirectUrl).toContain("/verify-email?error=invalid_token");
    }
  });
});
