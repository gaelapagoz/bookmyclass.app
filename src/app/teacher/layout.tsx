import TeacherSidebar from "@/components/teacher/TeacherSidebar";
import { requireTeacherSession } from "@/lib/auth/require-auth";

export default async function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireTeacherSession({
    callbackUrl: "/teacher",
    unauthorizedPath: "/dashboard",
  });

  return (
    <div className="min-h-screen bg-[#eef2f7] text-[#1f2735] md:flex">
      <TeacherSidebar />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
