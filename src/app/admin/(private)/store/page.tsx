import Link from "next/link";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  listAdminStoreGiftCardProducts,
  listAdminStoreMerchandise,
} from "@/lib/store/store-admin-catalog-service";
import { STORE_CURRENCY_CODE } from "@/lib/store/store-constants";

const PAGE_SIZE = 10;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: STORE_CURRENCY_CODE,
  }).format(amountMinor / 100);
}

function parsePositiveIntParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function buildPageHref(
  currentSearchParams: Record<string, string | string[] | undefined>,
  paramName: "merchandisePage" | "giftCardPage",
  page: number,
  hash: "merchandising" | "gift-cards",
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(currentSearchParams)) {
    if (key === paramName || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) query.append(key, entry);
      continue;
    }
    query.set(key, value);
  }

  if (page > 1) {
    query.set(paramName, String(page));
  }

  const queryString = query.toString();
  return queryString.length > 0 ? `?${queryString}#${hash}` : `#${hash}`;
}

export default async function AdminStorePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminSession();

  const resolvedSearchParams = await searchParams;

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

  const merchandisePage = parsePositiveIntParam(resolvedSearchParams.merchandisePage);
  const giftCardPage = parsePositiveIntParam(resolvedSearchParams.giftCardPage);

  const merchandiseTotalPages = Math.max(1, Math.ceil(merchandise.length / PAGE_SIZE));
  const giftCardTotalPages = Math.max(1, Math.ceil(giftCards.length / PAGE_SIZE));

  const normalizedMerchandisePage = Math.min(merchandisePage, merchandiseTotalPages);
  const normalizedGiftCardPage = Math.min(giftCardPage, giftCardTotalPages);

  const merchandiseStart = (normalizedMerchandisePage - 1) * PAGE_SIZE;
  const giftCardStart = (normalizedGiftCardPage - 1) * PAGE_SIZE;

  const merchandiseRows = merchandise.slice(merchandiseStart, merchandiseStart + PAGE_SIZE);
  const giftCardRows = giftCards.slice(giftCardStart, giftCardStart + PAGE_SIZE);

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
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
              <table className="min-w-full table-fixed text-sm" data-testid="admin-store-merchandise-table">
                <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                  <tr>
                    <th className="w-[40%] px-3 py-2">Name</th>
                    <th className="w-[20%] px-3 py-2">Price</th>
                    <th className="w-[20%] px-3 py-2">Status</th>
                    <th className="w-[20%] px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {merchandiseRows.map((item) => (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2 font-medium">{item.name}</td>
                      <td className="px-3 py-2">
                        {item.primaryPrice ? formatMoney(item.primaryPrice.unitAmountMinor) : "-"}
                      </td>
                      <td className="px-3 py-2">{item.isArchived ? "Archived" : item.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/store/merchandise/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {merchandiseTotalPages > 1 ? (
              <nav
                className="flex items-center justify-end gap-2 text-sm"
                data-testid="admin-store-merchandise-pagination"
                aria-label="Merchandise pagination"
              >
                {normalizedMerchandisePage > 1 ? (
                  <Link
                    href={buildPageHref(resolvedSearchParams, "merchandisePage", normalizedMerchandisePage - 1, "merchandising")}
                    className="rounded-md border border-[#d3dbe5] px-3 py-1 text-[#2a4f78]"
                  >
                    Previous
                  </Link>
                ) : null}
                <span className="text-[#4b5a72]">
                  Page {normalizedMerchandisePage} of {merchandiseTotalPages}
                </span>
                {normalizedMerchandisePage < merchandiseTotalPages ? (
                  <Link
                    href={buildPageHref(resolvedSearchParams, "merchandisePage", normalizedMerchandisePage + 1, "merchandising")}
                    className="rounded-md border border-[#d3dbe5] px-3 py-1 text-[#2a4f78]"
                  >
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
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
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
              <table className="min-w-full table-fixed text-sm" data-testid="admin-store-gift-cards-table">
                <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
                  <tr>
                    <th className="w-[40%] px-3 py-2">Name</th>
                    <th className="w-[20%] px-3 py-2">Price</th>
                    <th className="w-[20%] px-3 py-2">Status</th>
                    <th className="w-[20%] px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {giftCardRows.map((item) => (
                    <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                      <td className="px-3 py-2 font-medium">{item.name}</td>
                      <td className="px-3 py-2">
                        {item.activePrice ? formatMoney(item.activePrice.unitAmountMinor) : "-"}
                      </td>
                      <td className="px-3 py-2">{item.isArchived ? "Archived" : item.isActive ? "Active" : "Inactive"}</td>
                      <td className="px-3 py-2">
                        <Link href={`/admin/store/gift-cards/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {giftCardTotalPages > 1 ? (
              <nav
                className="flex items-center justify-end gap-2 text-sm"
                data-testid="admin-store-gift-cards-pagination"
                aria-label="Gift card pagination"
              >
                {normalizedGiftCardPage > 1 ? (
                  <Link
                    href={buildPageHref(resolvedSearchParams, "giftCardPage", normalizedGiftCardPage - 1, "gift-cards")}
                    className="rounded-md border border-[#d3dbe5] px-3 py-1 text-[#2a4f78]"
                  >
                    Previous
                  </Link>
                ) : null}
                <span className="text-[#4b5a72]">
                  Page {normalizedGiftCardPage} of {giftCardTotalPages}
                </span>
                {normalizedGiftCardPage < giftCardTotalPages ? (
                  <Link
                    href={buildPageHref(resolvedSearchParams, "giftCardPage", normalizedGiftCardPage + 1, "gift-cards")}
                    className="rounded-md border border-[#d3dbe5] px-3 py-1 text-[#2a4f78]"
                  >
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </div>
        )}
      </section>
    </section>
  );
}
