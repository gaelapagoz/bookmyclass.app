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

import { signIn } from "@/auth";
import { signInAction } from "../../src/app/(public)/sign-in/page";
import { registerAction } from "../../src/app/(public)/sign-up/page";

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

describe("auth actions integration", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(signIn).mockReset();
  });

  it("sign-up invalid input is rejected", async () => {
    await expect(
      registerAction(makeSignUpForm({ lastName: "", password: "short" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-up?error=invalid_input");
  });

  it("successful sign-up creates user and redirects to /dashboard", async () => {
    const email = `new.${Date.now()}@example.test`;

    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      const redirectTo = (options as { redirectTo?: string } | undefined)?.redirectTo ?? "/dashboard";
      const error = new Error(`NEXT_REDIRECT:${redirectTo}`);
      (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${redirectTo};307;`;
      throw error;
    });

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow("NEXT_REDIRECT:/dashboard");

    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
    expect(created?.passwordHash).toBeTruthy();
  });

  it("duplicate email shows expected error", async () => {
    await prisma.user.create({
      data: {
        name: "Existing User",
        firstName: "Existing",
        lastName: "User",
        email: "existing@example.test",
        passwordHash: await hash("Password123!", 12),
      },
    });

    await expect(
      registerAction(makeSignUpForm({ email: "existing@example.test" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-up?error=email_exists");
  });

  it("shows signin_failed when user is created but auto sign-in fails", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CredentialsSignin"));

    const email = `signin.fail.${Date.now()}@example.test`;

    await expect(registerAction(makeSignUpForm({ email }))).rejects.toThrow(
      "NEXT_REDIRECT:/sign-up?error=signin_failed",
    );

    const created = await prisma.user.findUnique({ where: { email } });
    expect(created).not.toBeNull();
  });

  it("sign-in action rejects invalid credentials", async () => {
    vi.mocked(signIn).mockRejectedValue(new AuthError("CredentialsSignin"));

    await expect(
      signInAction(makeSignInForm({ email: "bad@example.test", password: "wrong" })),
    ).rejects.toThrow("NEXT_REDIRECT:/sign-in?error=invalid_credentials&callbackUrl=%2Fdashboard");
  });

  it("sign-in action uses credentials fields and redirects to /dashboard", async () => {
    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      expect(_provider).toBe("credentials");
      expect((options as { email?: string }).email).toBe("ok@example.test");
      expect((options as { password?: string }).password).toBe("Password123!");
      expect((options as { redirectTo?: string }).redirectTo).toBe("/dashboard");

      const error = new Error("NEXT_REDIRECT:/dashboard");
      (error as Error & { digest?: string }).digest = "NEXT_REDIRECT;replace;/dashboard;307;";
      throw error;
    });

    await expect(
      signInAction(makeSignInForm({ email: "ok@example.test", password: "Password123!" })),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("sign-in action sanitizes protocol-relative callback URL to /dashboard", async () => {
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

  it("sign-in action sanitizes absolute callback URL to /dashboard", async () => {
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
          callbackUrl: "https://evil.com",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard");
  });

  it("sign-in action preserves safe internal callback URL", async () => {
    vi.mocked(signIn).mockImplementation(async (_provider, options) => {
      expect((options as { redirectTo?: string }).redirectTo).toBe("/dashboard/bookings");
      const error = new Error("NEXT_REDIRECT:/dashboard/bookings");
      (error as Error & { digest?: string }).digest = "NEXT_REDIRECT;replace;/dashboard/bookings;307;";
      throw error;
    });

    await expect(
      signInAction(
        makeSignInForm({
          email: "ok@example.test",
          password: "Password123!",
          callbackUrl: "/dashboard/bookings",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/dashboard/bookings");
  });
});
