import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  DashboardServiceError,
  getDashboardProfileData,
  updateDashboardProfile,
} from "@/lib/dashboard/dashboard-service";

type SearchParams = Promise<{
  error?: string;
  saved?: string;
}>;

function getMessage(params: { saved?: string; error?: string }) {
  if (params.saved === "1") {
    return { type: "success" as const, text: "Profile updated successfully." };
  }

  if (params.error === "email_exists") {
    return { type: "error" as const, text: "This email is already used by another account." };
  }

  if (params.error === "invalid_input") {
    return { type: "error" as const, text: "Please complete first name, last name, and email." };
  }

  if (params.error === "save_failed") {
    return { type: "error" as const, text: "Could not update profile right now." };
  }

  return null;
}

export default async function DashboardProfilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireAuth();
  const profile = await getDashboardProfileData(session.user.id);
  const params = await searchParams;
  const message = getMessage(params);

  async function saveProfileAction(formData: FormData) {
    "use server";

    const authSession = await requireAuth();

    try {
      await updateDashboardProfile(authSession.user.id, {
        firstName: String(formData.get("firstName") ?? ""),
        lastName: String(formData.get("lastName") ?? ""),
        email: String(formData.get("email") ?? ""),
        phone: String(formData.get("phone") ?? ""),
      });
    } catch (error) {
      if (error instanceof DashboardServiceError) {
        if (error.code === "EMAIL_ALREADY_IN_USE") {
          redirect("/dashboard/profile?error=email_exists");
        }

        if (error.code === "INVALID_PROFILE_INPUT") {
          redirect("/dashboard/profile?error=invalid_input");
        }
      }

      redirect("/dashboard/profile?error=save_failed");
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/profile");
    redirect("/dashboard/profile?saved=1");
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Profile</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Update your account contact details.</p>

      <DashboardNav />

      {message ? (
        <p
          className={`mb-4 text-sm ${message.type === "error" ? "text-[#7b2d2d]" : "text-[#2f6b35]"}`}
        >
          {message.text}
        </p>
      ) : null}

      <form action={saveProfileAction} className="rounded-xl border border-[#d8cec6] bg-white p-5">
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

        <button
          type="submit"
          className="mt-6 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] hover:opacity-90"
        >
          Save Profile
        </button>
      </form>
    </section>
  );
}
