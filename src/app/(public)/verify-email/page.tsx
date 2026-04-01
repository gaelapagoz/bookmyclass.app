import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";

import { auth } from "@/auth";
import { requestEmailVerification, verifyEmailByToken } from "@/lib/auth/email-verification-service";
import { getSafeCallbackPath } from "@/lib/auth/safe-callback-url";

type SearchParams = Promise<{
  blocked?: string;
  callbackUrl?: string;
  email?: string;
  error?: string;
  resend?: string;
  sent?: string;
  token?: string;
  verified?: string;
}>;

const resendSchema = z.object({
  email: z.string().trim().email(),
  callbackUrl: z.string().trim().optional(),
});

function getMessage(params: {
  blocked?: string;
  error?: string;
  sent?: string;
  verified?: string;
}) {
  if (params.verified === "1") {
    return { type: "success" as const, text: "Email verified. You can now sign in." };
  }
  if (params.sent === "1") {
    return { type: "success" as const, text: "Verification email sent." };
  }
  if (params.error === "invalid_token") {
    return { type: "error" as const, text: "Verification link is invalid or expired." };
  }
  if (params.error === "send_failed") {
    return { type: "error" as const, text: "Could not send verification email right now." };
  }
  if (params.error === "rate_limited") {
    return { type: "error" as const, text: "Please wait before requesting another verification email." };
  }
  if (params.blocked === "1") {
    return { type: "error" as const, text: "Please verify your email before accessing the dashboard." };
  }
  return null;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = getSafeCallbackPath(params.callbackUrl, "/dashboard");
  const email = String(params.email ?? session?.user?.email ?? "").trim().toLowerCase();

  if (params.token && email) {
    const verified = await verifyEmailByToken({
      email,
      token: params.token,
    });
    redirect(
      verified
        ? `/verify-email?verified=1&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`
        : `/verify-email?error=invalid_token&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`,
    );
  }

  if (params.resend === "1" && email) {
    try {
      const outcome = await requestEmailVerification({
        email,
        appUrl: process.env.APP_URL,
      });
      if (outcome.outcome === "RATE_LIMITED") {
        redirect(`/verify-email?error=rate_limited&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      }
      redirect(`/verify-email?sent=1&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    } catch (error) {
      Sentry.captureException(error);
      console.error("[verify-email] resend failed", error);
      redirect(`/verify-email?error=send_failed&email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackUrl)}`);
    }
  }

  const message = getMessage(params);
  const isVerifiedSuccessState = params.verified === "1";

  async function resendVerificationAction(formData: FormData) {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "auth.resendVerificationAction",
      { recordResponse: false },
      async () => {
        const parsed = resendSchema.safeParse({
          email: formData.get("email"),
          callbackUrl: formData.get("callbackUrl") ?? undefined,
        });

        if (!parsed.success) {
          redirect("/verify-email?error=send_failed");
        }

        const nextCallbackUrl = getSafeCallbackPath(parsed.data.callbackUrl, "/dashboard");
        try {
          const result = await requestEmailVerification({
            email: parsed.data.email,
            appUrl: process.env.APP_URL,
          });
          if (result.outcome === "RATE_LIMITED") {
            redirect(
              `/verify-email?error=rate_limited&email=${encodeURIComponent(parsed.data.email)}&callbackUrl=${encodeURIComponent(nextCallbackUrl)}`,
            );
          }
        } catch (error) {
          Sentry.captureException(error);
          console.error("[verify-email] resend action failed", error);
          redirect(
            `/verify-email?error=send_failed&email=${encodeURIComponent(parsed.data.email)}&callbackUrl=${encodeURIComponent(nextCallbackUrl)}`,
          );
        }

        redirect(
          `/verify-email?sent=1&email=${encodeURIComponent(parsed.data.email)}&callbackUrl=${encodeURIComponent(nextCallbackUrl)}`,
        );
      },
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Verify Your Email</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">
        Verify your email to access protected dashboard routes.
      </p>

      {message ? (
        <p className={`mt-4 text-sm ${message.type === "error" ? "text-[#7b2d2d]" : "text-[#2f6b35]"}`}>
          {message.text}
        </p>
      ) : null}

      {isVerifiedSuccessState ? (
        <Link
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="mt-8 inline-flex w-fit rounded-md bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#f4eee8] hover:opacity-90"
        >
          Continue to Sign In
        </Link>
      ) : (
        <>
          <form action={resendVerificationAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <label className="block text-sm text-[#5f4040]">
              Email
              <input
                name="email"
                type="email"
                defaultValue={email}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
            >
              Resend Verification Email
            </button>
          </form>

          <p className="mt-4 text-sm text-[#7f5a5a]">
            Back to{" "}
            <Link
              href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
              className="font-medium text-[#7b2d2d] underline underline-offset-4"
            >
              Sign in
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

