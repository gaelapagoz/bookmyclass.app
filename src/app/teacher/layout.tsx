import TeacherSidebar from "@/components/teacher/TeacherSidebar";

export default function TeacherLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-[#eef2f7] text-[#1f2735] md:flex">
      <TeacherSidebar />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
