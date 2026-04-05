import { redirect } from "next/navigation";
import TeacherSidebar from "@/components/teacher/TeacherSidebar";
import { requireUserSession } from "@/lib/auth/require-auth";

export default async function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await requireUserSession({
    callbackUrl: "/teacher",
  });

  const role = session.user.role;
  if (role !== "TEACHER" && role !== "ADMIN" && role !== "MASTER_ADMIN") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-[#eef2f7] text-[#1f2735] md:flex">
      <TeacherSidebar />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
