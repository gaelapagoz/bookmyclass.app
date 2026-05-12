import Link from "next/link";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  getStorePriceCheckoutReadinessLabel,
  listAdminStoreGiftCardProducts,
} from "@/lib/store/store-admin-catalog-service";
import { STORE_CURRENCY_CODE } from "@/lib/store/store-constants";

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: STORE_CURRENCY_CODE,
  }).format(amountMinor / 100);
}

export default async function AdminStoreGiftCardsPage() {
  await requireAdminSession();

  let items;
  try {
    items = await listAdminStoreGiftCardProducts();
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Store: Gift Cards</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">
          Unable to load gift-card catalog right now.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Store: Gift Cards</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Manage sellable gift-card denominations. EUR only, one-time, Stripe sync required.
            Max 500 EUR per denomination. Gift-card wallets and redemption history are under Sales.
          </p>
        </div>
        <Link
          href="/admin/store/gift-cards/new"
          className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white"
        >
          Add gift card
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
          No gift-card products found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Amount (EUR)</th>
                <th className="px-3 py-2">Stripe ID</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Checkout</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">
                    {item.activePrice ? formatMoney(item.activePrice.unitAmountMinor) : "-"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-[#5a6d86]">
                    {item.activePrice?.stripePriceId ?? "Not synced"}
                  </td>
                  <td className="px-3 py-2">
                    {item.isArchived
                      ? "Archived"
                      : item.isActive
                        ? "Active"
                        : "Inactive"}
                  </td>
                  <td className="px-3 py-2">
                    {getStorePriceCheckoutReadinessLabel(item.activePrice, item)}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/store/gift-cards/${item.id}/edit`}
                      className="text-[#2a4f78] underline underline-offset-4"
                    >
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
}
