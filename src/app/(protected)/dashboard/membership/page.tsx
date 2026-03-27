import { requireAuth } from "@/lib/auth/require-auth";
import { ManageBillingButton } from "@/components/subscription/ManageBillingButton";
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
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Membership & Credits</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">Track active packs, usable credits, and recurring memberships.</p>
      {data.canManageStripeBilling ? <div className="mt-4"><ManageBillingButton /></div> : null}

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
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Usable Credits</h2>
          <p className="mt-2 text-3xl font-semibold text-[#6f2b2b]">{data.usableCredits}</p>
          <p className="mt-1 text-xs text-[#7f5a5a]">Calculated across all active packs.</p>
          <p className="mt-1 text-xs text-[#7f5a5a]">
            Credits are used from the earliest-expiring pack first.
          </p>
        </article>
      </div>

      <section className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Active Packs</h2>
        {data.activeCreditPacks.length === 0 ? (
          <p className="mt-2 text-sm text-[#5f4040]">No active credit packs available.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.activeCreditPacks.map((pack) => (
              <li key={pack.entitlementId} className="rounded-md border border-[#ebe1d8] px-3 py-2 text-sm">
                <p className="font-medium text-[#6f2b2b]">{pack.productName}</p>
                <p className="text-[#5f4040]">Remaining credits: {pack.remainingCredits}</p>
                <p className="text-[#5f4040]">Status: {pack.status}</p>
                <p className="text-[#5f4040]">
                  Expires: {pack.expiresAt ? formatDate(pack.expiresAt) : "No expiry"}
                </p>
                {pack.nextToConsume ? (
                  <p className="text-xs font-medium text-[#7b2d2d]">Next pack to be consumed</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Purchase History</h2>
        {data.ownedOneTimeProducts.length === 0 ? (
          <p className="mt-2 text-sm text-[#5f4040]">No one-time product purchases found.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.ownedOneTimeProducts.map((purchase) => (
              <li
                key={`${purchase.orderId}:${purchase.productId}`}
                className="rounded-md border border-[#ebe1d8] px-3 py-2 text-sm"
              >
                <p className="font-medium text-[#6f2b2b]">{purchase.productName}</p>
                <p className="text-[#5f4040]">Category: {purchase.productType} (one-time purchase)</p>
                <p className="text-[#5f4040]">Price: {purchase.priceName}</p>
                <p className="text-[#5f4040]">
                  Purchased: {formatDate(purchase.purchasedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Recurring Subscriptions</h2>
        {data.recurringSubscriptions.length === 0 ? (
          <p className="mt-2 text-sm text-[#5f4040]">No recurring subscriptions found.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.recurringSubscriptions.map((subscription) => (
              <li
                key={subscription.subscriptionContractId}
                className="rounded-md border border-[#ebe1d8] px-3 py-2 text-sm"
              >
                <p className="font-medium text-[#6f2b2b]">{subscription.productName}</p>
                <p className="text-[#5f4040]">Status: {subscription.status}</p>
                <p className="text-[#5f4040]">Provider: {subscription.provider}</p>
                {subscription.cancelAtPeriodEnd ? (
                  <p className="text-[#5f4040]">
                    Cancels at period end: {formatDate(subscription.currentPeriodEnd)}
                  </p>
                ) : (
                  <p className="text-[#5f4040]">Renews on: {formatDate(subscription.currentPeriodEnd)}</p>
                )}
                {subscription.cancelledAt ? (
                  <p className="text-[#5f4040]">Cancelled at: {formatDate(subscription.cancelledAt)}</p>
                ) : null}
                {subscription.endedAt ? (
                  <p className="text-[#5f4040]">Ended at: {formatDate(subscription.endedAt)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
