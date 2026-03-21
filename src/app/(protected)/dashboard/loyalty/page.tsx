import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardLoyaltyPlaceholder } from "@/lib/dashboard/dashboard-service";

export default async function DashboardLoyaltyPage() {
  const session = await requireAuth();
  const points = await getDashboardLoyaltyPlaceholder(session.user.id);

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Loyalty</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Loyalty program placeholder for a later milestone.</p>

      <DashboardNav />

      <article className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Current Placeholder Balance</h2>
        <p className="mt-2 text-3xl font-semibold text-[#6f2b2b]">{points}</p>
        <p className="mt-2 text-sm text-[#5f4040]">
          This is a placeholder view. Earning and redemption rules will be added later.
        </p>
      </article>
    </section>
  );
}
