import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";

import { auth, signIn } from "@/auth";
import { isAdminLoginCaptchaEnforced, getAdminLoginAbuseState } from "@/lib/auth/admin-login-abuse-service";
import { isAdminRole } from "@/lib/auth/admin-access";
import { getAdminLoginCaptchaSiteKey } from "@/lib/auth/admin-login-captcha";
import { isInvalidCredentialsAuthError } from "@/lib/auth/auth-error-utils";
import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";
import { getClientIpFromHeaders } from "@/lib/security/rate-limit";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  callbackUrl?: string;
  error?: string;
  guard?: string;
}>;

function resolveCaptchaToken(formData: FormData): string | null {
  const raw =
    String(formData.get("captchaToken") ?? "").trim() ||
    String(formData.get("turnstileToken") ?? "").trim() ||
    String(formData.get("cf-turnstile-response") ?? "").trim();

  return raw || null;
}

export async function adminSignInAction(formData: FormData) {
  "use server";

  return Sentry.withServerActionInstrumentation(
    "auth.adminSignInAction",
    { recordResponse: false },
    async () => {
      await assertSameOriginServerAction();

      const email = String(formData.get("email") ?? "").trim().toLowerCase();
      const password = String(formData.get("password") ?? "");
      const callbackUrl = getSafeCallbackPath(formData.get("callbackUrl"), "/admin/dashboard");
      const requestHeaders = await headers();
      const ip = getClientIpFromHeaders(requestHeaders);
      const captchaToken = resolveCaptchaToken(formData);
      const captchaEnforced = isAdminLoginCaptchaEnforced();

      if (!email || !password) {
        redirect(`/admin?error=invalid_input&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }

      const preState = await getAdminLoginAbuseState({
        ip,
        normalizedEmail: email,
      });

      if (preState.isLocked) {
        redirect(`/admin?error=invalid_credentials&guard=locked&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }

      if (preState.requiresCaptcha && captchaEnforced && !captchaToken) {
        redirect(`/admin?error=invalid_credentials&guard=captcha_required&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }

      try {
        await signIn("credentials", {
          email,
          password,
          authFlow: "admin",
          captchaToken: captchaToken ?? undefined,
          redirectTo: callbackUrl || "/admin/dashboard",
        });
      } catch (error) {
        if (isInvalidCredentialsAuthError(error)) {
          const postFailureState = await getAdminLoginAbuseState({
            ip,
            normalizedEmail: email,
          });

          const guard = postFailureState.isLocked
            ? "locked"
            : postFailureState.requiresCaptcha && captchaEnforced
              ? "captcha_required"
              : "none";

          const guardQuery = guard === "none" ? "" : `&guard=${encodeURIComponent(guard)}`;

          redirect(`/admin?error=invalid_credentials${guardQuery}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
        }

        if (error instanceof AuthError) {
          Sentry.captureException(error);
          redirect(`/admin?error=auth_failed&callbackUrl=${encodeURIComponent(callbackUrl)}`);
        }

        throw error;
      }
    },
  );
}

function getErrorMessage(error?: string, guard?: string) {
  if (!error) {
    return null;
  }

  if (error === "invalid_input") {
    return "Please enter your email and password.";
  }

  if (error === "invalid_credentials" || error === "CredentialsSignin") {
    if (guard === "locked") {
      return "Invalid email or password. Please wait a few minutes and try again.";
    }

    if (guard === "captcha_required") {
      return "Invalid email or password. Complete the verification challenge and try again.";
    }

    return "Invalid email or password.";
  }

  if (error === "unauthorized") {
    return "Your account does not have admin access.";
  }

  if (error === "auth_failed") {
    return "Could not sign in right now. Please try again.";
  }

  return "Could not sign in right now. Please try again.";
}

export default async function AdminEntryPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await auth();

  if (session?.user && isAdminRole(session.user.role)) {
    redirect("/admin/dashboard");
  }

  const { callbackUrl: rawCallbackUrl = "/admin/dashboard", error, guard } = await searchParams;
  const callbackUrl = getSafeCallbackPath(rawCallbackUrl, "/admin/dashboard");
  const errorMessage = getErrorMessage(error, guard);
  const captchaSiteKey = getAdminLoginCaptchaSiteKey();
  const shouldRenderCaptcha = guard === "captcha_required" && Boolean(captchaSiteKey);

  const isNonAdminUser = Boolean(session?.user) && !isAdminRole(session?.user?.role);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f2ede7] px-4 py-10 text-[#4f2a2a]">
      <div className="w-full max-w-md rounded-2xl border border-[#d8cec6] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/images/logo.png"
            alt="Yoga Pilates Fitness Studio logo"
            width={96}
            height={96}
            className="h-24 w-24 rounded-full object-cover"
            priority
          />
          <p className="mt-4 text-xs uppercase tracking-[0.18em] text-[#8a5959]">Admin Portal</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#6f2b2b]">Yoga Pilates Fitness Studio</h1>
        </div>

        {isNonAdminUser ? (
          <div className="space-y-4 rounded-xl border border-[#e4d8cf] bg-[#f9f5f1] p-4">
            <p className="text-sm text-[#7b2d2d]">Your account is signed in but does not have admin access.</p>
            <div className="flex gap-3">
              <Link href="/" className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90">
                Back to Site
              </Link>
            </div>
          </div>
        ) : (
          <>
            {errorMessage ? <p className="mb-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

            <form action={adminSignInAction} className="space-y-4 rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-5">
              <input type="hidden" name="callbackUrl" value={callbackUrl} />

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

              {shouldRenderCaptcha ? (
                <>
                  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
                  <div className="cf-turnstile" data-sitekey={captchaSiteKey ?? ""} data-theme="light" />
                </>
              ) : null}

              <button
                type="submit"
                className="w-full rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
              >
                Sign In to Admin
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
