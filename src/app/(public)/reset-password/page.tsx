import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { PasswordServiceError, resetPasswordWithToken } from "@/lib/auth/password-service";
import { TokenFromHashBridge } from "./token-from-hash-bridge";

type SearchParams = Promise<{
  token?: string;
  error?: string;
  success?: string;
}>;

function getMessage(params: { error?: string; success?: string }) {
  if (params.success === "1") {
    return { type: "success" as const, text: "Password updated. You can now sign in." };
  }

  if (params.error === "invalid_token") {
    return { type: "error" as const, text: "Reset link is invalid or expired." };
  }

  if (params.error === "invalid_input") {
    return {
      type: "error" as const,
      text: "Password must be at least 8 characters and match confirmation.",
    };
  }

  if (params.error === "reset_failed") {
    return { type: "error" as const, text: "Could not reset password right now." };
  }

  return null;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const token = String(params.token ?? "").trim();
  const message = getMessage(params);

  async function resetPasswordAction(formData: FormData) {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "auth.resetPasswordAction",
      { recordResponse: false },
      async () => {
        const submittedToken = String(formData.get("token") ?? "").trim();
        const newPassword = String(formData.get("newPassword") ?? "");
        const confirmNewPassword = String(formData.get("confirmNewPassword") ?? "");

        try {
          await resetPasswordWithToken({
            token: submittedToken,
            newPassword,
            confirmNewPassword,
          });
        } catch (error) {
          Sentry.captureException(error);
          if (error instanceof PasswordServiceError) {
            if (error.code === "TOKEN_INVALID_OR_EXPIRED") {
              redirect("/reset-password?error=invalid_token");
            }

            if (error.code === "INVALID_PASSWORD" || error.code === "PASSWORD_MISMATCH") {
              redirect(`/reset-password?token=${encodeURIComponent(submittedToken)}&error=invalid_input`);
            }
          }

          redirect(`/reset-password?token=${encodeURIComponent(submittedToken)}&error=reset_failed`);
        }

        redirect("/sign-in?password_reset=1");
      },
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Reset Password</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Set your new password.</p>

      {message ? (
        <p className={`mt-4 text-sm ${message.type === "error" ? "text-[#7b2d2d]" : "text-[#2f6b35]"}`}>
          {message.text}
        </p>
      ) : null}

      <TokenFromHashBridge />

      {!token ? <p className="mt-4 text-sm text-[#7f5a5a]">Waiting for reset token...</p> : null}

      {token ? (
        <form action={resetPasswordAction} className="mt-8 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-5">
          <input type="hidden" name="token" value={token} />

          <label className="block text-sm text-[#5f4040]">
            New password
            <input
              name="newPassword"
              type="password"
              minLength={8}
              required
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#5f4040]">
            Confirm new password
            <input
              name="confirmNewPassword"
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
            Save New Password
          </button>
        </form>
      ) : null}

      <p className="mt-4 text-sm text-[#7f5a5a]">
        Back to{" "}
        <Link href="/sign-in" className="font-medium text-[#7b2d2d] underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </main>
  );
}

