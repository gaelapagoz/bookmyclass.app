import Link from "next/link";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  getStorePriceCheckoutReadinessLabel,
  listAdminStoreGiftCardProducts,
  listAdminStoreMerchandise,
} from "@/lib/store/store-admin-catalog-service";
import { STORE_CURRENCY_CODE, STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: STORE_CURRENCY_CODE,
  }).format(amountMinor / 100);
}

export default async function AdminStorePage() {
  await requireAdminSession();

  let merchandise;
  let giftCards;
  try {
    [merchandise, giftCards] = await Promise.all([
      listAdminStoreMerchandise(),
      listAdminStoreGiftCardProducts(),
    ]);
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Store</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load store catalog right now.</p>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Store</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">
            Manage customer-visible merchandise and gift-card catalog products.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <a className="rounded-md border border-[#d3dbe5] px-3 py-2 text-[#2a4f78]" href="#merchandising">
            Merchandising
          </a>
          <a className="rounded-md border border-[#d3dbe5] px-3 py-2 text-[#2a4f78]" href="#gift-cards">
            Gift Cards
          </a>
        </div>
      </header>

      <section id="merchandising" className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1f2735]">Merchandising</h2>
            <p className="mt-1 text-sm text-[#4b5a72]">
              Sellable merchandise requires active one-time prices and Stripe sync before client checkout.
            </p>
          </div>
          <Link href="/admin/store/merchandise/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Add merchandise
          </Link>
        </header>

        {merchandise.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No merchandise products found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Fulfillment</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Checkout Ready</th>
                  <th className="px-3 py-2">Visible to Client</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {merchandise.map((item) => {
                  const readinessLabel = getStorePriceCheckoutReadinessLabel(item.primaryPrice, item);
                  const isReady = item.isCheckoutReady;
                  return (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2 font-medium">{item.name}</td>
                      <td className="px-3 py-2">
                        {item.primaryPrice ? formatMoney(item.primaryPrice.unitAmountMinor) : "-"}
                      </td>
                      <td className="px-3 py-2 text-[#5a6d86]">{STORE_PICKUP_WORDING}</td>
                      <td className="px-3 py-2">{item.isArchived ? "Archived" : item.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <span className={isReady ? "text-[#166534]" : "text-[#7b2d2d]"}>
                          {isReady ? "Yes" : "No"}
                        </span>
                        {!isReady && (
                          <span className="ml-1 text-xs text-[#7b2d2d]">— {readinessLabel}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={isReady ? "text-[#166534] font-medium" : "text-[#7b2d2d]"}>
                          {isReady ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/store/merchandise/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="gift-cards" className="space-y-4">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-[#1f2735]">Gift Cards</h2>
            <p className="mt-1 text-sm text-[#4b5a72]">
              Gift-card denominations are EUR one-time products with no maximum denomination cap.
            </p>
          </div>
          <Link href="/admin/store/gift-cards/new" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm text-white">
            Add gift card
          </Link>
        </header>

        {giftCards.length === 0 ? (
          <div className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#4b5a72]">
            No gift-card products found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Stripe ID</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Checkout Ready</th>
                  <th className="px-3 py-2">Visible to Client</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {giftCards.map((item) => {
                  const readinessLabel = getStorePriceCheckoutReadinessLabel(item.activePrice, item);
                  const isReady = item.isCheckoutReady;
                  return (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2 font-medium">{item.name}</td>
                      <td className="px-3 py-2">
                        {item.activePrice ? formatMoney(item.activePrice.unitAmountMinor) : "-"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[#5a6d86]">
                        {item.activePrice?.stripePriceId ?? (
                          <span className="text-[#7b2d2d]">Not synced — attach a Stripe price ID to enable checkout</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{item.isArchived ? "Archived" : item.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <span className={isReady ? "text-[#166534]" : "text-[#7b2d2d]"}>
                          {isReady ? "Yes" : "No"}
                        </span>
                        {!isReady && (
                          <span className="ml-1 text-xs text-[#7b2d2d]">— {readinessLabel}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={isReady ? "text-[#166534] font-medium" : "text-[#7b2d2d]"}>
                          {isReady ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/store/gift-cards/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
