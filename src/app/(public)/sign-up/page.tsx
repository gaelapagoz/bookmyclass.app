import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { auth } from "@/auth";
import { hashPassword } from "@/lib/auth/password-service";
import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";
import { createPendingPublicRegistration } from "@/lib/auth/user-identity-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
  email?: string;
}>;

export async function registerAction(formData: FormData) {
  "use server";

  return Sentry.withServerActionInstrumentation(
    "auth.registerAction",
    { recordResponse: false },
    async () => {
      await assertSameOriginServerAction();

      const firstName = String(formData.get("firstName") ?? "").trim();
      const lastName = String(formData.get("lastName") ?? "").trim();
      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      const password = String(formData.get("password") ?? "");
      const honeypot = String(formData.get("company") ?? "");
      const callbackUrl = getSafeCallbackPath(formData.get("callbackUrl"), "/dashboard");
      let ipAddress = "unknown";
      try {
        const requestHeaders = await headers();
        const forwardedFor = requestHeaders.get("x-forwarded-for");
        const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
        ipAddress = firstForwardedIp || requestHeaders.get("x-real-ip") || "unknown";
      } catch {
        ipAddress = "unknown";
      }

      if (!firstName || !lastName || !email || !password || password.length < 8) {
        redirect(`/sign-up?error=invalid_input&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }

      const passwordHash = await hashPassword(password);

      try {
        const result = await createPendingPublicRegistration({
          firstName,
          lastName,
          email,
          passwordHash,
          honeypot,
          ipAddress,
          appUrl: process.env.APP_URL,
        });

        if (result.outcome === "RATE_LIMITED") {
          redirect(`/sign-up?error=rate_limited&callbackUrl=${encodeURIComponent(callbackUrl)}&email=${encodeURIComponent(email)}`);
        }

        if (result.outcome === "BLOCKED_DISPOSABLE") {
          redirect(`/sign-up?error=disposable_email&callbackUrl=${encodeURIComponent(callbackUrl)}`);
        }
      } catch (error: unknown) {
        Sentry.captureException(error);
        redirect(`/sign-up?error=signup_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }

      redirect(`/verify-email?sent=1&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    },
  );
}

function getErrorMessage(error?: string) {
  if (!error) {
    return null;
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

  if (error === "disposable_email") {
    return "Please use a non-temporary email address.";
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
        <input
          type="text"
          name="company"
          autoComplete="off"
          tabIndex={-1}
          className="hidden"
          aria-hidden="true"
        />

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

