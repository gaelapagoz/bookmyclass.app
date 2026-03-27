import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { hashPassword } from "@/lib/auth/password-service";
import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";
import { requestEmailVerification } from "@/lib/auth/email-verification-service";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
  email?: string;
}>;

const SIGNUP_RATE_LIMIT_WINDOW_MS = 60 * 1000;

function parseName(firstName: string, lastName: string) {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

function isPrismaKnownError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}

function hashSignupRateLimitKey(email: string): string {
  return createHash("sha256")
    .update(`signup-rate-limit:${email}`)
    .digest("hex");
}

async function isSignupRateLimited(email: string, now: Date): Promise<boolean> {
  const emailHash = hashSignupRateLimitKey(email);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.passwordResetRateLimit.findUnique({
      where: { emailHash },
      select: { lastRequestedAt: true },
    });

    if (
      existing &&
      now.getTime() - existing.lastRequestedAt.getTime() < SIGNUP_RATE_LIMIT_WINDOW_MS
    ) {
      return true;
    }

    await tx.passwordResetRateLimit.upsert({
      where: { emailHash },
      update: { lastRequestedAt: now },
      create: {
        emailHash,
        lastRequestedAt: now,
      },
    });

    return false;
  });
}

export async function registerAction(formData: FormData) {
  "use server";

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const callbackUrl = getSafeCallbackPath(formData.get("callbackUrl"), "/dashboard");

  if (!firstName || !lastName || !email || !password || password.length < 8) {
    redirect(`/sign-up?error=invalid_input&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const rateLimited = await isSignupRateLimited(email, new Date());
  if (rateLimited) {
    redirect(`/sign-up?error=rate_limited&callbackUrl=${encodeURIComponent(callbackUrl)}&email=${encodeURIComponent(email)}`);
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: { id: true, emailVerified: true },
  });

  if (existingUser?.emailVerified) {
    redirect(`/sign-up?error=email_exists&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const passwordHash = await hashPassword(password);
  const baseData = {
    name: parseName(firstName, lastName),
    email,
    passwordHash,
    role: "CLIENT" as const,
    isActive: true,
    isInactive: false,
    emailVerified: null,
  };

  try {
    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          ...baseData,
          firstName,
          lastName,
        },
        select: { id: true },
      });
    } else {
      await prisma.user.create({
        data: {
          ...baseData,
          firstName,
          lastName,
        },
        select: { id: true },
      });
    }
  } catch (error: unknown) {
    if (isPrismaKnownError(error) && error.code === "P2002") {
      redirect(`/sign-up?error=email_exists&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }

    redirect(`/sign-up?error=signup_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  try {
    await requestEmailVerification({
      email,
      appUrl: process.env.APP_URL,
    });
  } catch (error) {
    console.error("[sign-up] verification send failed", error);
    redirect(`/sign-up?error=verification_send_failed&callbackUrl=${encodeURIComponent(callbackUrl)}&email=${encodeURIComponent(email)}`);
  }

  redirect(`/verify-email?sent=1&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
}

function getErrorMessage(error?: string) {
  if (!error) {
    return null;
  }

  if (error === "email_exists") {
    return "An account with this email already exists.";
  }

  if (error === "invalid_input") {
    return "Please fill all fields correctly. Password must be at least 8 characters.";
  }

  if (error === "signup_failed") {
    return "Could not create account right now. Please try again.";
  }

  if (error === "rate_limited") {
    return "Please wait before trying to sign up again.";
  }

  if (error === "verification_send_failed") {
    return "Account created, but verification email could not be sent right now.";
  }

  return "Could not create account.";
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const { error, callbackUrl: rawCallbackUrl = "/dashboard", email } = await searchParams;
  const callbackUrl = getSafeCallbackPath(rawCallbackUrl, "/dashboard");
  if (session?.user) {
    redirect(callbackUrl);
  }

  const errorMessage = getErrorMessage(error);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Sign Up</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Create your account to access your dashboard.</p>

      {errorMessage ? <p className="mt-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

      <form action={registerAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        <label className="block text-sm text-[#5f4040]">
          First name
          <input
            name="firstName"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#5f4040]">
          Last name
          <input
            name="lastName"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#5f4040]">
          Email
          <input
            name="email"
            type="email"
            defaultValue={email ?? ""}
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#5f4040]">
          Password
          <input
            name="password"
            type="password"
            minLength={8}
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
        >
          Create Account
        </button>
      </form>

      <p className="mt-4 text-sm text-[#7f5a5a]">
        Already have an account?{" "}
        <Link
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="font-medium text-[#7b2d2d] underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
