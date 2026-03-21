import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardMembershipData } from "@/lib/dashboard/dashboard-service";

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
  }).format(new Date(iso));
}

export default async function DashboardMembershipPage() {
  const session = await requireAuth();
  const data = await getDashboardMembershipData(session.user.id);

  return (
    <section>
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Membership / Plans</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">View your active membership and available credits.</p>


      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[#d8cec6] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Active Subscription</h2>
          {data.activeSubscription ? (
            <>
              <p className="mt-2 font-medium text-[#5f4040]">{data.activeSubscription.productName}</p>
              <p className="text-sm text-[#5f4040]">
                Status: {data.activeSubscription.status}
              </p>
              <p className="text-sm text-[#5f4040]">
                Period: {formatDate(data.activeSubscription.currentPeriodStart)} -{" "}
                {formatDate(data.activeSubscription.currentPeriodEnd)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-[#5f4040]">No active subscription.</p>
          )}
        </article>

        <article className="rounded-xl border border-[#d8cec6] bg-white p-5">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Credits Left</h2>
          <p className="mt-2 text-3xl font-semibold text-[#6f2b2b]">{data.creditsLeft}</p>
          <p className="mt-1 text-xs text-[#7f5a5a]">Computed from credit ledger entries.</p>
        </article>
      </div>

      <section className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Active Plans & Packs</h2>
        {data.currentPlans.length === 0 ? (
          <p className="mt-2 text-sm text-[#5f4040]">No active plans found.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.currentPlans.map((plan) => (
              <li key={`${plan.source}:${plan.planId}`} className="rounded-md border border-[#ebe1d8] px-3 py-2 text-sm">
                <p className="font-medium text-[#6f2b2b]">{plan.productName}</p>
                <p className="text-[#5f4040]">Source: {plan.source}</p>
                <p className="text-[#5f4040]">Type: {plan.planType}</p>
                <p className="text-[#5f4040]">Status: {plan.status}</p>
                {plan.remainingCredits !== null ? (
                  <p className="text-[#5f4040]">Remaining credits: {plan.remainingCredits}</p>
                ) : (
                  <p className="text-[#5f4040]">Usage: Membership / unlimited access</p>
                )}
                {plan.expiresAt ? <p className="text-[#5f4040]">Expires: {formatDate(plan.expiresAt)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
