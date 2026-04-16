import TeacherSidebar from "@/components/teacher/TeacherSidebar";
import { requireTeacherSession } from "@/lib/auth/require-auth";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

export default async function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  async function handleTeacherSignOut(_formData: FormData) {
    "use server";
    await assertSameOriginServerAction();
    const { signOut } = await import("@/auth");
    await signOut({ redirectTo: "/admin" });
  }

  await requireTeacherSession({
    callbackUrl: "/teacher",
    unauthorizedPath: "/dashboard",
  });

  return (
    <div className="min-h-screen bg-[#eef2f7] text-[#1f2735] md:flex">
      <TeacherSidebar onSignOutAction={handleTeacherSignOut} />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
