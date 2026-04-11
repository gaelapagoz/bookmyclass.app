import { signOut } from "@/auth";
import AdminSidebar from "@/components/admin/AdminSidebar";
import { requireAdminSession } from "@/lib/auth/require-auth";
import { getUnreadClientMessagesCount } from "@/lib/client-messages/client-message-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

export default async function AdminPrivateLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  async function handleAdminSignOut(_formData: FormData) {
    "use server";
    await assertSameOriginServerAction();
    await signOut({ redirectTo: "/admin" });
  }

  await requireAdminSession();

  let unreadInboxCount = 0;
  try {
    unreadInboxCount = await getUnreadClientMessagesCount();
  } catch (error) {
    console.error("[AdminPrivateLayout] Failed to load unread inbox count", error);
  }

  return (
    <div className="min-h-screen bg-[#e8edf3] text-[#1f2735] md:flex">
      <AdminSidebar unreadInboxCount={unreadInboxCount} onSignOutAction={handleAdminSignOut} />
      <main className="flex-1 p-5 md:p-8">{children}</main>
    </div>
  );
}
