import { redirect } from "next/navigation";

import { auth } from "@/auth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { isAdminRole } from "@/lib/auth/admin-access";

export default async function AdminPrivateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  if (!session?.user) {
    redirect("/admin");
  }

  if (!isAdminRole(session.user.role)) {
    redirect("/admin?error=unauthorized");
  }

  return (
    <div className="min-h-screen bg-[#e8edf3] text-[#1f2735] md:flex">
      <AdminSidebar />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}

