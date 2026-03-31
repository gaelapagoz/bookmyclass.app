import { redirect } from "next/navigation";

import { auth } from "@/auth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { isAdminRole } from "@/lib/auth/admin-access";
import { getUnreadClientMessagesCount } from "@/lib/client-messages/client-message-service";

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

  let unreadInboxCount = 0;
  try {
    unreadInboxCount = await getUnreadClientMessagesCount();
  } catch (error) {
    console.error("[AdminPrivateLayout] Failed to load unread inbox count", error);
  }

  return (
    <div className="min-h-screen bg-[#e8edf3] text-[#1f2735] md:flex">
      <AdminSidebar unreadInboxCount={unreadInboxCount} />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
