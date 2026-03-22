import Link from "next/link";

import { getAdminPlansData } from "@/lib/admin/admin-service";

function formatPrice(amountMinor: number | null, currencyCode: string | null): string {
  if (amountMinor === null || !currencyCode) {
    return "-";
  }

  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function formatBilling(input: {
  currentPriceType: string | null;
  currentBillingInterval: string | null;
  currentBillingIntervalCount: number | null;
}): string {
  if (!input.currentPriceType) {
    return "-";
  }

  if (input.currentPriceType === "ONE_TIME") {
    return "One-time";
  }

  if (!input.currentBillingInterval) {
    return "Recurring";
  }

  const interval = input.currentBillingInterval.toLowerCase();
  const count = input.currentBillingIntervalCount ?? 1;

  return count === 1 ? `Every ${interval}` : `Every ${count} ${interval}s`;
}

export default async function AdminPlansPage() {
  try {
    const plans = await getAdminPlansData();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Plans</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Manage studio offerings and their current pricing.</p>
          </div>
          <Link href="/admin/plans/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Create plan
          </Link>
        </header>

        {plans.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No plans found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Current Price</th>
                  <th className="px-3 py-2">Billing</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Checkout</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((item) => (
                  <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">{item.productType}</td>
                    <td className="px-3 py-2">{formatPrice(item.currentPriceAmountMinor, item.currentPriceCurrencyCode)}</td>
                    <td className="px-3 py-2">
                      {formatBilling({
                        currentPriceType: item.currentPriceType,
                        currentBillingInterval: item.currentBillingInterval,
                        currentBillingIntervalCount: item.currentBillingIntervalCount,
                      })}
                    </td>
                    <td className="px-3 py-2">{item.isActive ? "Active" : "Inactive"}</td>
                    <td className="px-3 py-2">{item.isCheckoutReady ? "Ready" : "Needs attention"}</td>
                    <td className="px-3 py-2">
                      <Link href={`/admin/plans/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Plans</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load plans right now.</p>
      </section>
    );
  }
}

