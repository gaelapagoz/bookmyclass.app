import { requireTeacherSession } from "@/lib/auth/require-auth";
import { getTeacherSelfProfile } from "@/lib/teacher/teacher-service";
import { updateTeacherProfileAction, changeTeacherPasswordAction } from "@/app/teacher/actions";

type SearchParams = Promise<{
  error?: string;
  success?: string;
  password_success?: string;
  password_error?: string;
}>;

export default async function TeacherProfilePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireTeacherSession({
    callbackUrl: "/teacher/profile",
    unauthorizedPath: "/dashboard",
  });
  const profile = await getTeacherSelfProfile(session.user.id);
  const { error, success, password_success, password_error } = await searchParams;

  if (!profile) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">My Teacher Profile</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">
          Only your own teacher profile can be viewed and edited here.
        </p>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#1d5c34]">{success}</p> : null}
      {password_success ? <p className="text-sm text-[#1d5c34]">{password_success}</p> : null}
      {password_error ? <p className="text-sm text-[#7b2d2d]">{password_error}</p> : null}

      <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#1f2735]">Profile Information</h2>

        <form action={updateTeacherProfileAction} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm text-[#334155]">
              First name
              <input
                name="firstName"
                required
                defaultValue={profile.firstName}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Last name
              <input
                name="lastName"
                required
                defaultValue={profile.lastName}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
          </div>

          <label className="block text-sm text-[#334155]">
            Email
            <input
              value={profile.email}
              disabled
              className="mt-1 w-full rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-[#475569]"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Phone
            <input
              name="phone"
              defaultValue={profile.phone}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Bio
            <textarea
              name="bio"
              rows={3}
              defaultValue={profile.bio}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Specialties (comma or new line separated)
            <textarea
              name="specialties"
              rows={3}
              defaultValue={profile.specialties.join("\n")}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <label className="block text-sm text-[#334155]">
            Certifications (comma or new line separated)
            <textarea
              name="certifications"
              rows={3}
              defaultValue={profile.certifications.join("\n")}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Save Profile
          </button>
        </form>
      </section>

      <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#1f2735]">Change Password</h2>
        <p className="text-sm text-[#4b5a72]">
          Update your password using your current password.
        </p>

        <form action={changeTeacherPasswordAction} className="space-y-3">
          <label className="block text-sm text-[#334155]">
            Current password
            <input
              name="currentPassword"
              type="password"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            New password
            <input
              name="newPassword"
              type="password"
              minLength={8}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Confirm new password
            <input
              name="confirmPassword"
              type="password"
              minLength={8}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>

          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update Password
          </button>
        </form>
      </section>
    </section>
  );
}