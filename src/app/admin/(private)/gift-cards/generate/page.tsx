import AdminGiftCardGenerationPanel from "@/components/admin/gift-cards/AdminGiftCardGenerationPanel";
import { requireAdminSession } from "@/lib/auth/require-auth";

export default async function AdminGiftCardGeneratePage() {
  await requireAdminSession();

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Gift Cards</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Generate and send an admin gift card code.</p>
      </header>
      <AdminGiftCardGenerationPanel />
    </section>
  );
}
