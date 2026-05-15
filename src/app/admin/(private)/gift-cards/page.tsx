import Link from "next/link";
import { Role } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  listAdminGiftCardWalletBalances,
  listAdminIssuedGiftCardCodes,
} from "@/lib/gift-cards/gift-card-admin-service";

type SearchParams = Promise<{
  query?: string | string[];
  issuedRecipientEmail?: string | string[];
  issuedPage?: string | string[];
  walletsPage?: string | string[];
}>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined, fallback = 1) {
  const parsed = Number(firstParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function formatDate(value: Date | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AdminGiftCardsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const query = firstParam(params.query)?.trim() ?? "";
  const issuedRecipientEmail = firstParam(params.issuedRecipientEmail)?.trim() ?? "";
  const issuedPage = parsePage(params.issuedPage);
  const walletsPage = parsePage(params.walletsPage);
  const actor = { userId: session.user.id, role: session.user.role as Role };
  const issuedCodes = await listAdminIssuedGiftCardCodes({
    actor,
    recipientEmail: issuedRecipientEmail,
    page: issuedPage,
    pageSize: 20,
  });
  const walletBalances = await listAdminGiftCardWalletBalances({ actor, query, page: walletsPage, pageSize: 20 });

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Gift Cards</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Issued Gift Cards and Wallets / Balances.</p>
        </div>
        <Link href="/admin/gift-cards/generate" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm font-semibold text-white">Generate Gift Card</Link>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#1f2735]">Issued Gift Cards</h2>
        <form action="/admin/gift-cards" className="flex flex-wrap gap-2">
          <input name="issuedRecipientEmail" defaultValue={issuedRecipientEmail} placeholder="Search by recipient email" className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm md:min-w-80" />
          <input type="hidden" name="query" value={query} />
          <input type="hidden" name="issuedPage" value="1" />
          <input type="hidden" name="walletsPage" value={String(walletsPage)} />
          <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm font-semibold text-white">Search</button>
        </form>
        <div className="overflow-x-auto rounded-md border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Recipient</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Issued By</th>
                <th className="px-3 py-2">Redeemed By</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2">Redeemed</th>
                <th className="px-3 py-2">Masked Code</th>
                <th className="px-3 py-2">Email</th>
              </tr>
            </thead>
            <tbody>
              {issuedCodes.items.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0]">
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">{formatMoney(item.amountMinor, item.currencyCode)}</td>
                  <td className="px-3 py-2">{item.recipientEmail ?? item.purchasedBy?.email ?? "-"}</td>
                  <td className="px-3 py-2">{item.source}</td>
                  <td className="px-3 py-2">{item.generatedBy?.name ?? item.generatedBy?.email ?? item.purchasedBy?.name ?? item.purchasedBy?.email ?? "-"}</td>
                  <td className="px-3 py-2">{item.redeemedBy?.name ?? item.redeemedBy?.email ?? "-"}</td>
                  <td className="px-3 py-2">{formatDate(item.issuedAt)}</td>
                  <td className="px-3 py-2">{formatDate(item.redeemedAt)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{item.maskedCode}</td>
                  <td className="px-3 py-2">{item.emailStatus}</td>
                </tr>
              ))}
              {issuedCodes.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-5 text-center text-[#5a6d86]">No issued gift cards found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-sm text-[#4b5a72]">
          <span>Page {issuedCodes.page} of {issuedCodes.totalPages}</span>
          <div className="flex gap-2">
            {issuedCodes.page > 1 ? (
              <Link href={`/admin/gift-cards?query=${encodeURIComponent(query)}&issuedRecipientEmail=${encodeURIComponent(issuedRecipientEmail)}&issuedPage=${issuedCodes.page - 1}&walletsPage=${walletsPage}`} className="rounded border border-[#cbd5e1] px-2 py-1">Previous</Link>
            ) : <span className="rounded border border-[#e2e8f0] px-2 py-1 text-[#94a3b8]">Previous</span>}
            {issuedCodes.page < issuedCodes.totalPages ? (
              <Link href={`/admin/gift-cards?query=${encodeURIComponent(query)}&issuedRecipientEmail=${encodeURIComponent(issuedRecipientEmail)}&issuedPage=${issuedCodes.page + 1}&walletsPage=${walletsPage}`} className="rounded border border-[#cbd5e1] px-2 py-1">Next</Link>
            ) : <span className="rounded border border-[#e2e8f0] px-2 py-1 text-[#94a3b8]">Next</span>}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#1f2735]">Wallets / Balances</h2>
        <form action="/admin/gift-cards" className="flex flex-wrap gap-2">
          <input name="query" defaultValue={query} placeholder="Search by client name or email" className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm md:min-w-80" />
          <input type="hidden" name="issuedRecipientEmail" value={issuedRecipientEmail} />
          <input type="hidden" name="issuedPage" value={String(issuedPage)} />
          <input type="hidden" name="walletsPage" value="1" />
          <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm font-semibold text-white">Search</button>
        </form>
        <div className="overflow-x-auto rounded-md border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase text-[#5a6d86]"><tr><th className="px-3 py-2">Client</th><th className="px-3 py-2">Email</th><th className="px-3 py-2">Current Balance</th><th className="px-3 py-2">Active Gift Cards</th><th className="px-3 py-2">Last Activity</th></tr></thead>
            <tbody>
              {walletBalances.items.map((item) => (
                <tr key={item.walletId} className="border-t border-[#e2e8f0]">
                  <td className="px-3 py-2">{item.client.name ?? "-"}</td>
                  <td className="px-3 py-2">{item.client.email}</td>
                  <td className="px-3 py-2">{formatMoney(item.balanceMinor, item.currencyCode)}</td>
                  <td className="px-3 py-2">{item.activeGiftCards}</td>
                  <td className="px-3 py-2">{formatDate(item.lastActivityAt)}</td>
                </tr>
              ))}
              {walletBalances.items.length === 0 ? <tr><td colSpan={5} className="px-3 py-5 text-center text-[#5a6d86]">No wallet balances found.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between text-sm text-[#4b5a72]">
          <span>Page {walletBalances.page} of {walletBalances.totalPages}</span>
          <div className="flex gap-2">
            {walletBalances.page > 1 ? (
              <Link href={`/admin/gift-cards?query=${encodeURIComponent(query)}&issuedRecipientEmail=${encodeURIComponent(issuedRecipientEmail)}&issuedPage=${issuedPage}&walletsPage=${walletBalances.page - 1}`} className="rounded border border-[#cbd5e1] px-2 py-1">Previous</Link>
            ) : <span className="rounded border border-[#e2e8f0] px-2 py-1 text-[#94a3b8]">Previous</span>}
            {walletBalances.page < walletBalances.totalPages ? (
              <Link href={`/admin/gift-cards?query=${encodeURIComponent(query)}&issuedRecipientEmail=${encodeURIComponent(issuedRecipientEmail)}&issuedPage=${issuedPage}&walletsPage=${walletBalances.page + 1}`} className="rounded border border-[#cbd5e1] px-2 py-1">Next</Link>
            ) : <span className="rounded border border-[#e2e8f0] px-2 py-1 text-[#94a3b8]">Next</span>}
          </div>
        </div>
      </section>
    </section>
  );
}
