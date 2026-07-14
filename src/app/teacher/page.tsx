import Link from "next/link";

import { requireTeacherSession } from "@/lib/auth/require-auth";
import { getTeacherAssignedSessions, getTeacherSelfProfile } from "@/lib/teacher/teacher-service";

export default async function TeacherHomePage() {
  const session = await requireTeacherSession({
    callbackUrl: "/teacher",
    unauthorizedPath: "/dashboard",
  });
  const [profile, sessions] = await Promise.all([
    getTeacherSelfProfile(session.user.id),
    getTeacherAssignedSessions({ teacherUserId: session.user.id }),
  ]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Teacher Dashboard</h1>
        <p className="mt-2 text-sm text-[#4b5a72]">
          Welcome back{profile ? `, ${profile.firstName || profile.fullName}` : ""}.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-5">
          <h2 className="text-base font-semibold text-[#1f2735]">Assigned Sessions</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">
            You have <strong>{sessions.length}</strong> upcoming assigned session{sessions.length === 1 ? "" : "s"}.
          </p>
          <Link href="/teacher/sessions" className="mt-3 inline-block text-sm text-[#2a4f78] underline underline-offset-4">
            View my schedule
          </Link>
        </article>

        <article className="rounded-xl border border-[#d3dbe5] bg-white p-5">
          <h2 className="text-base font-semibold text-[#1f2735]">Your Profile</h2>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Update the profile information shown to clients and studio staff.
          </p>
          <Link href="/teacher/profile" className="mt-3 inline-block text-sm text-[#2a4f78] underline underline-offset-4">
            Edit profile
          </Link>
        </article>
      </section>
    </div>
  );
}
