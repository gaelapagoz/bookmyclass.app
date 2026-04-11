import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  changeAuthenticatedUserPassword,
  PasswordServiceError,
  type PasswordServiceErrorCode,
} from "@/lib/auth/password-service";
import {
  DashboardServiceError,
  getDashboardProfileData,
  updateDashboardProfile,
} from "@/lib/dashboard/dashboard-service";
import { requestDashboardPasswordResetByUserId } from "@/lib/dashboard/dashboard-password-reset";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

type SearchParams = Promise<{
  profile_error?: string;
  profile_email_change?: string;
  profile_saved?: string;
  password_error?: string;
  password_saved?: string;
  reset_error?: string;
  reset_sent?: string;
}>;

type ProfilePageMessage = {
  type: "success" | "error";
  text: string;
};

function resolvePasswordServiceErrorCode(error: unknown): PasswordServiceErrorCode | null {
  if (error instanceof PasswordServiceError) {
    return error.code;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (
      code === "INVALID_CURRENT_PASSWORD" ||
      code === "INVALID_PASSWORD" ||
      code === "PASSWORD_MISMATCH" ||
      code === "PASSWORD_NOT_SET"
    ) {
      return code;
    }
  }

  return null;
}

function mapPasswordActionError(error: unknown): string | null {
  const errorCode = resolvePasswordServiceErrorCode(error);
  if (errorCode === "INVALID_CURRENT_PASSWORD") {
    return "invalid_current";
  }
  if (errorCode === "INVALID_PASSWORD") {
    return "invalid_password";
  }
  if (errorCode === "PASSWORD_MISMATCH") {
    return "password_mismatch";
  }
  if (errorCode === "PASSWORD_NOT_SET") {
    return "password_not_set";
  }
  return null;
}

function getMessages(params: {
  profile_saved?: string;
  profile_email_change?: string;
  profile_error?: string;
  password_saved?: string;
  password_error?: string;
  reset_sent?: string;
  reset_error?: string;
}): ProfilePageMessage[] {
  const messages: ProfilePageMessage[] = [];

  if (params.profile_saved === "1") {
    messages.push({ type: "success", text: "Profile updated successfully." });
  }

  if (params.profile_email_change === "1") {
    messages.push({
      type: "success",
      text: "Email change requested. Verify the new email address to complete the update.",
    });
  }

  if (params.password_saved === "1") {
    messages.push({ type: "success", text: "Password updated successfully." });
  }

  if (params.reset_sent === "1") {
    messages.push({
      type: "success",
      text: "Password reset email sent. Check your inbox for the reset link.",
    });
  }

  if (params.profile_error === "email_exists") {
    messages.push({ type: "error", text: "This email is already used by another account." });
  }

  if (params.profile_error === "invalid_input") {
    messages.push({ type: "error", text: "Please complete first name, last name, and email." });
  }

  if (params.profile_error === "email_change_requires_password") {
    messages.push({
      type: "error",
      text: "Current password is required to request an email change.",
    });
  }

  if (params.profile_error === "invalid_current_password") {
    messages.push({ type: "error", text: "Current password is incorrect for email change." });
  }

  if (params.profile_error === "save_failed") {
    messages.push({ type: "error", text: "Could not update profile right now." });
  }

  if (params.password_error === "invalid_current") {
    messages.push({ type: "error", text: "Current password is incorrect." });
  }

  if (params.password_error === "invalid_password") {
    messages.push({ type: "error", text: "Password must be at least 8 characters." });
  }

  if (params.password_error === "password_mismatch") {
    messages.push({
      type: "error",
      text: "New password and confirmation do not match.",
    });
  }

  if (params.password_error === "password_not_set") {
    messages.push({
      type: "error",
      text: "Password login is not enabled for this account.",
    });
  }

  if (params.password_error === "save_failed") {
    messages.push({ type: "error", text: "Could not update password right now." });
  }

  if (params.reset_error === "send_failed") {
    messages.push({ type: "error", text: "Could not send password reset email right now." });
  }

  return messages;
}

export default async function DashboardProfilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAuth();
  const profile = await getDashboardProfileData(session.user.id);
  const params = await searchParams;
  const messages = getMessages(params);

  async function saveProfileAction(formData: FormData) {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "dashboard.saveProfileAction",
      { recordResponse: false },
      async () => {
        await assertSameOriginServerAction();

        const authSession = await requireAuth();

        try {
          await updateDashboardProfile(authSession.user.id, {
            firstName: String(formData.get("firstName") ?? ""),
            lastName: String(formData.get("lastName") ?? ""),
            email: String(formData.get("email") ?? ""),
            phone: String(formData.get("phone") ?? ""),
            currentPasswordForEmailChange: String(formData.get("currentPasswordForEmailChange") ?? ""),
            appUrl: process.env.APP_URL,
          });
        } catch (error) {
          Sentry.captureException(error);
          if (error instanceof DashboardServiceError) {
            if (error.code === "EMAIL_ALREADY_IN_USE") {
              redirect("/dashboard/profile?profile_error=email_exists");
            }

            if (error.code === "INVALID_PROFILE_INPUT") {
              redirect("/dashboard/profile?profile_error=invalid_input");
            }

            if (error.code === "EMAIL_CHANGE_REQUIRES_PASSWORD") {
              redirect("/dashboard/profile?profile_error=email_change_requires_password");
            }

            if (error.code === "INVALID_CURRENT_PASSWORD") {
              redirect("/dashboard/profile?profile_error=invalid_current_password");
            }
          }

          redirect("/dashboard/profile?profile_error=save_failed");
        }

        revalidatePath("/dashboard");
        revalidatePath("/dashboard/profile");
        const emailChanged = String(formData.get("email") ?? "").trim().toLowerCase() !== profile.email.toLowerCase();
        if (emailChanged) {
          redirect("/dashboard/profile?profile_saved=1&profile_email_change=1");
        }
        redirect("/dashboard/profile?profile_saved=1");
      },
    );
  }

  async function changePasswordAction(formData: FormData) {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "dashboard.changePasswordAction",
      { recordResponse: false },
      async () => {
        await assertSameOriginServerAction();

        const authSession = await requireAuth();
        const currentPassword = String(formData.get("currentPassword") ?? "");
        const newPassword = String(formData.get("newPassword") ?? "");
        const confirmPassword = String(formData.get("confirmPassword") ?? "");

        try {
          await changeAuthenticatedUserPassword({
            userId: authSession.user.id,
            currentPassword,
            newPassword,
            confirmNewPassword: confirmPassword,
          });
        } catch (error) {
          Sentry.captureException(error);
          const mappedError = mapPasswordActionError(error);
          if (mappedError) {
            redirect(`/dashboard/profile?password_error=${mappedError}`);
          }

          redirect("/dashboard/profile?password_error=save_failed");
        }

        revalidatePath("/dashboard/profile");
        redirect("/dashboard/profile?password_saved=1");
      },
    );
  }

  async function sendPasswordResetAction() {
    "use server";

    return Sentry.withServerActionInstrumentation(
      "dashboard.sendPasswordResetAction",
      { recordResponse: false },
      async () => {
        await assertSameOriginServerAction();

        const authSession = await requireAuth();

        try {
          await requestDashboardPasswordResetByUserId({
            userId: authSession.user.id,
            appUrl: process.env.APP_URL,
          });
        } catch (error) {
          Sentry.captureException(error);
          console.error("[dashboard/profile] failed to trigger reset email", {
            userId: authSession.user.id,
            errorName: error instanceof Error ? error.name : null,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          redirect("/dashboard/profile?reset_error=send_failed");
        }

        revalidatePath("/dashboard/profile");
        redirect("/dashboard/profile?reset_sent=1");
      },
    );
  }

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Profile</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">
        Manage your account details, password, and recovery settings.
      </p>

      {messages.length > 0 ? (
        <div className="space-y-2">
          {messages.map((message, index) => (
            <p
              key={`${message.type}:${index}`}
              className={`text-sm ${message.type === "error" ? "text-[#7b2d2d]" : "text-[#2f6b35]"}`}
            >
              {message.text}
            </p>
          ))}
        </div>
      ) : null}

      <section className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Account Details</h2>
        <p className="mt-1 text-sm text-[#7f5a5a]">Update your profile and contact details.</p>
        <form action={saveProfileAction} className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-[#5f4040]">
              First name
              <input
                name="firstName"
                defaultValue={profile.firstName}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
            <label className="text-sm text-[#5f4040]">
              Last name
              <input
                name="lastName"
                defaultValue={profile.lastName}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-[#5f4040]">
              Email
              <input
                type="email"
                name="email"
                defaultValue={profile.email}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
            <label className="text-sm text-[#5f4040]">
              Phone
              <input
                name="phone"
                defaultValue={profile.phone}
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
          </div>

          <div className="mt-4">
            <label className="text-sm text-[#5f4040]">
              Current password (required only when changing email)
              <input
                type="password"
                name="currentPasswordForEmailChange"
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-6 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
          >
            Save Profile
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Change Password</h2>
        <p className="mt-1 text-sm text-[#7f5a5a]">Update your password using your current password.</p>
        <form action={changePasswordAction} className="mt-4">
          <div className="grid gap-4">
            <label className="text-sm text-[#5f4040]">
              Current password
              <input
                name="currentPassword"
                type="password"
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
            <label className="text-sm text-[#5f4040]">
              New password
              <input
                name="newPassword"
                type="password"
                minLength={8}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
            <label className="text-sm text-[#5f4040]">
              Confirm new password
              <input
                name="confirmPassword"
                type="password"
                minLength={8}
                required
                className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
              />
            </label>
          </div>

          <button
            type="submit"
            className="mt-6 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
          >
            Update Password
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Forgot password?</h2>
        <p className="mt-1 text-sm text-[#7f5a5a]">
          Send a reset link to your account email ({profile.email}) without signing out.
        </p>
        <form action={sendPasswordResetAction} className="mt-4">
          <button
            type="submit"
            className="rounded-md border border-[#7b2d2d] px-4 py-2 text-sm text-[#7b2d2d] hover:bg-[#f2ede7]"
          >
            Send Password Reset Email
          </button>
        </form>
      </section>
    </section>
  );
}

