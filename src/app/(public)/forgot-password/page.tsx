import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";
import { PasswordServiceError, requestPasswordReset } from "@/lib/auth/password-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  sent?: string;
  error?: string;
}>;

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const sent = params.sent === "1";
  const deliveryFailed = params.error === "delivery_failed";
  const requestFailed = params.error === "request_failed";

  async function requestResetAction(formData: FormData) {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "auth.requestResetAction",
      { recordResponse: false },
      async () => {
        await assertSameOriginServerAction();

        const email = String(formData.get("email") ?? "").trim().toLowerCase();
        if (process.env.NODE_ENV !== "production" && process.env.AUTH_DEBUG_PASSWORD_RESET === "1") {
          console.info("[forgot-password] request-entered", {
            hasEmail: email.length > 0,
            hasResendApiKey: Boolean(process.env.RESEND_API_KEY?.trim()),
            hasEmailFrom: Boolean(process.env.EMAIL_FROM?.trim()),
            hasAppUrl: Boolean(process.env.APP_URL?.trim()),
          });
        }

        try {
          await requestPasswordReset({
            email,
            appUrl: process.env.APP_URL,
          });
        } catch (error) {
          Sentry.captureException(error);
          console.error("[forgot-password] request failed", { error });
          if (error instanceof PasswordServiceError && error.code === "PASSWORD_RESET_DELIVERY_FAILED") {
            redirect("/forgot-password?error=delivery_failed");
          }
          redirect("/forgot-password?error=request_failed");
        }

        redirect("/forgot-password?sent=1");
      }
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Forgot Password</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">
        Enter your email and we will send you a reset link if the account exists.
      </p>

      {sent ? (
        <p className="mt-4 text-sm text-[#2f6b35]">
          If an account exists for that email, a reset link has been sent.
        </p>
      ) : null}
      {deliveryFailed ? (
        <p className="mt-4 text-sm text-[#7b2d2d]">
          We could not send reset email right now. Please try again in a few minutes.
        </p>
      ) : null}
      {requestFailed ? (
        <p className="mt-4 text-sm text-[#7b2d2d]">
          Password reset is temporarily unavailable. Please try again shortly.
        </p>
      ) : null}

      <form action={requestResetAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
        <label className="block text-sm text-[#5f4040]">
          Email
          <input
            name="email"
            type="email"
            required
            className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
          />
        </label>

        <button
          type="submit"
          className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
        >
          Send Reset Link
        </button>
      </form>

      <p className="mt-4 text-sm text-[#7f5a5a]">
        Back to{" "}
        <Link href="/sign-in" className="font-medium text-[#7b2d2d] underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}

