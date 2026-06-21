import { UserActivationStatus } from "@prisma/client";
import { AuthError } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { auth, signIn } from "@/auth";
import { resolvePublicAuthPageRedirect } from "@/lib/auth/public-auth-page";
import { getSignInEligibilityUserByEmail } from "@/lib/auth/sign-in-service";
import { getSafeCallbackPath, getPostSignInRedirectUrl } from "@/lib/auth/safe-callback-url";
import { isInvalidCredentialsAuthError } from "@/lib/auth/auth-error-utils";
import { assertValidCsrfToken, createCsrfToken, getCsrfFieldName } from "@/lib/security/csrf-token";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
  password_reset?: string;
  email?: string;
}>;

export async function signInAction(formData: FormData) {
  "use server";

  return Sentry.withServerActionInstrumentation(
    "auth.signInAction",
    { recordResponse: false },
    async () => {
      await assertSameOriginServerAction();
      await assertValidCsrfToken(formData);

      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      const password = String(formData.get("password") ?? "");
      const explicitCallbackUrl = String(formData.get("callbackUrl") ?? "");
      const sanitizedCallbackUrl = getSafeCallbackPath(explicitCallbackUrl, "/dashboard");

      if (!email || !password) {
        redirect(`/sign-in?error=invalid_input&callbackUrl=${encodeURIComponent(sanitizedCallbackUrl)}`);
      }

      const user = await getSignInEligibilityUserByEmail(email);

      // Check user activation status (required for all roles)
      if (user && user.activationStatus !== UserActivationStatus.ACTIVE) {
        redirect(
          `/sign-in?error=email_not_verified&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(sanitizedCallbackUrl)}`,
        );
      }

      // Check email verification (required only for CLIENT users)
      if (user && user.role === "CLIENT" && !user.emailVerified) {
        redirect(
          `/sign-in?error=email_not_verified&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(sanitizedCallbackUrl)}`,
        );
      }

      // Determine redirect URL based on user role
      const roleBasedRedirectUrl = user ? getPostSignInRedirectUrl(user.role) : "/dashboard";
      // Use explicit callback if provided and safe, otherwise use role-based redirect
      const finalRedirectUrl = getSafeCallbackPath(explicitCallbackUrl, roleBasedRedirectUrl);

      try {
        await signIn("credentials", {
          email,
          password,
          redirectTo: finalRedirectUrl,
        });
      } catch (error) {
        if (isInvalidCredentialsAuthError(error)) {
          redirect(`/sign-in?error=invalid_credentials&callbackUrl=${encodeURIComponent(finalRedirectUrl)}`);
        }

        if (error instanceof AuthError) {
          Sentry.captureException(error);
          redirect(`/sign-in?error=auth_failed&callbackUrl=${encodeURIComponent(finalRedirectUrl)}`);
        }

        throw error;
      }
    },
  );
}

function getErrorMessage(error?: string) {
  if (!error) {
    return null;
  }

  if (error === "invalid_input") {
    return "Please enter your email and password.";
  }

  if (error === "invalid_credentials" || error === "CredentialsSignin") {
    return "Invalid email or password.";
  }

  if (error === "email_not_verified") {
    return "Please verify your email before signing in.";
  }

  if (error === "auth_failed") {
    return "Could not sign in right now. Please try again.";
  }

  return "Could not sign in right now. Please try again.";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const { callbackUrl: rawCallbackUrl = "/dashboard", error, email: rawEmail, password_reset } = await searchParams;
  const email = String(rawEmail ?? "").trim();
  const callbackUrl = getSafeCallbackPath(rawCallbackUrl, "/dashboard");
  const sessionRedirectTarget = await resolvePublicAuthPageRedirect({
    session,
    callbackUrl,
  });
  if (sessionRedirectTarget) {
    redirect(sessionRedirectTarget);
  }
  const errorMessage = getErrorMessage(error);
  const csrfToken = await createCsrfToken();
  const csrfFieldName = getCsrfFieldName();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Sign In</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Sign in to access your dashboard.</p>

      {errorMessage ? <p className="mt-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}
      {password_reset === "1" ? (
        <p className="mt-2 text-sm text-[#2f6b35]">Password updated. Please sign in with your new password.</p>
      ) : null}
      {error === "email_not_verified" && email ? (
        <p className="mt-2 text-sm text-[#7f5a5a]">
          <Link
            href={`/verify-email?email=${encodeURIComponent(email)}&resend=1&callbackUrl=${encodeURIComponent(callbackUrl)}`}
            className="font-medium text-[#7b2d2d] underline underline-offset-4"
          >
            Resend verification email
          </Link>
        </p>
      ) : null}

      <form action={signInAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
        <input type="hidden" name="callbackUrl" value={callbackUrl} />
        {csrfToken ? <input type="hidden" name={csrfFieldName} value={csrfToken} /> : null}

        <label className="block text-sm text-[#5f4040]">
          Email
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <label className="block text-sm text-[#5f4040]">
          Password
          <input
            name="password"
            type="password"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
        >
          Sign In
        </button>
      </form>

      <p className="mt-3 text-sm text-[#7f5a5a]">
        <Link
          href="/forgot-password"
          className="font-medium text-[#7b2d2d] underline underline-offset-4"
        >
          Forgot password?
        </Link>
      </p>

      <p className="mt-4 text-sm text-[#7f5a5a]">
        Don&apos;t have an account?{" "}
        <Link
          href={`/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="font-medium text-[#7b2d2d] underline underline-offset-4"
        >
          Sign up
        </Link>
      </p>
    </main>
  );
}
