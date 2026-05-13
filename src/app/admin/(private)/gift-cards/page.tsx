import { GiftCardReconciliationStatus, Role } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
  getAdminGiftCardWalletLookup,
  listAdminGiftCardReconciliationCases,
} from "@/lib/gift-cards/gift-card-admin-service";

type SearchParams = Promise<{
  clientId?: string | string[];
  status?: string | string[];
  page?: string | string[];
}>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function parsePage(value: string | string[] | undefined) {
  const parsed = Number(firstParam(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseStatus(value: string | string[] | undefined) {
  const raw = firstParam(value);
  if (raw === "ALL" || Object.values(GiftCardReconciliationStatus).includes(raw as GiftCardReconciliationStatus)) {
    return raw as GiftCardReconciliationStatus | "ALL";
  }
  return undefined;
}

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AdminGiftCardsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAdminSession();
  const params = await searchParams;
  const clientId = firstParam(params.clientId)?.trim() ?? "";
  const page = parsePage(params.page);
  const status = parseStatus(params.status);
  const actor = { userId: session.user.id, role: session.user.role as Role };
  const walletLookupResult = clientId
    ? await getAdminGiftCardWalletLookup({ actor, clientId, page, pageSize: 20 })
        .then((data) => ({ data, error: false }))
        .catch(() => ({ data: null, error: true }))
    : { data: null, error: false };
  const walletLookup = walletLookupResult.data;
  const cases = await listAdminGiftCardReconciliationCases({
    actor,
    status,
    page,
    pageSize: 20,
  });

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Gift Cards</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Wallet lookup and reconciliation visibility.</p>
        </div>
        <form action="/admin/gift-cards" className="flex flex-wrap gap-2">
          <input
            name="clientId"
            defaultValue={clientId}
            placeholder="Client ID"
            className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm"
          />
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-[#cbd5e1] bg-white px-3 py-2 text-sm"
          >
            <option value="">Open cases</option>
            <option value="MANUAL_REVIEW">Manual review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All cases</option>
          </select>
          <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-2 text-sm font-semibold text-white">
            Search
          </button>
        </form>
      </header>

      <div className="rounded-md border border-[#d3dbe5] bg-white p-4 text-sm text-[#4b5a72]">
        {GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER}
      </div>

      {walletLookup ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[#1f2735]">Wallet Lookup</h2>
          {walletLookup.wallet ? (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-[#d3dbe5] bg-white p-4">
                  <p className="text-xs uppercase text-[#5a6d86]">Settled balance</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatMoney(walletLookup.wallet.balanceMinor, walletLookup.wallet.currencyCode)}
                  </p>
                </div>
                <div className="rounded-md border border-[#d3dbe5] bg-white p-4">
                  <p className="text-xs uppercase text-[#5a6d86]">Reserved</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatMoney(walletLookup.wallet.reservedAmountMinor ?? 0, walletLookup.wallet.currencyCode)}
                  </p>
                </div>
                <div className="rounded-md border border-[#d3dbe5] bg-white p-4">
                  <p className="text-xs uppercase text-[#5a6d86]">Available</p>
                  <p className="mt-1 text-xl font-semibold">
                    {formatMoney(walletLookup.wallet.availableBalanceMinor ?? 0, walletLookup.wallet.currencyCode)}
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-md border border-[#d3dbe5] bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#f3f6fb] text-left text-xs uppercase text-[#5a6d86]">
                    <tr>
                      <th className="px-3 py-2">When</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Amount</th>
                      <th className="px-3 py-2">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walletLookup.ledgerEntries.map((entry) => (
                      <tr key={entry.id} className="border-t border-[#e2e8f0]">
                        <td className="px-3 py-2">{formatDate(entry.happenedAt)}</td>
                        <td className="px-3 py-2">{entry.entryType}</td>
                        <td className="px-3 py-2">{formatMoney(entry.amountMinor, entry.currencyCode)}</td>
                        <td className="px-3 py-2">{entry.orderId ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {walletLookup.giftCardCodes && walletLookup.giftCardCodes.length > 0 ? (
                <div className="mt-4">
                  <h3 className="mb-2 text-sm font-semibold text-[#1f2735]">Redeemed Gift Card Codes</h3>
                  <div className="overflow-x-auto rounded-md border border-[#d3dbe5] bg-white">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[#f3f6fb] text-left text-xs uppercase text-[#5a6d86]">
                        <tr>
                          <th className="px-3 py-2">Code</th>
                          <th className="px-3 py-2">Amount</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Issued</th>
                          <th className="px-3 py-2">Redeemed</th>
                          <th className="px-3 py-2">Purchaser</th>
                          <th className="px-3 py-2">Redeemer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {walletLookup.giftCardCodes.map((code) => (
                          <tr key={code.id} className="border-t border-[#e2e8f0]">
                            <td className="px-3 py-2 font-mono text-xs">{code.maskedCode}</td>
                            <td className="px-3 py-2">{formatMoney(code.amountMinor, code.currencyCode)}</td>
                            <td className="px-3 py-2">{code.status}</td>
                            <td className="px-3 py-2">{formatDate(code.issuedAt)}</td>
                            <td className="px-3 py-2">{code.redeemedAt ? formatDate(code.redeemedAt) : "-"}</td>
                            <td className="px-3 py-2">
                              {code.purchasedBy
                                ? <span>{code.purchasedBy.name ?? code.purchasedBy.email}<p className="text-xs text-[#5a6d86]">{code.purchasedBy.id}</p></span>
                                : "-"}
                            </td>
                            <td className="px-3 py-2">
                              {code.redeemedBy
                                ? <span>{code.redeemedBy.name ?? code.redeemedBy.email}<p className="text-xs text-[#5a6d86]">{code.redeemedBy.id}</p></span>
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-md border border-[#d3dbe5] bg-white p-4 text-sm text-[#4b5a72]">
              No EUR gift-card wallet exists for this client.
            </div>
          )}
        </section>
      ) : null}

      {walletLookupResult.error ? (
        <div className="rounded-md border border-[#d3dbe5] bg-white p-4 text-sm text-[#7b2d2d]">
          Unable to find a client wallet lookup for the supplied client ID.
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#1f2735]">Reconciliation Cases</h2>
        <div className="overflow-x-auto rounded-md border border-[#d3dbe5] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.items.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0]">
                  <td className="px-3 py-2">{formatDate(item.createdAt)}</td>
                  <td className="px-3 py-2">
                    {item.client.name ?? item.client.email}
                    <p className="text-xs text-[#5a6d86]">{item.client.id}</p>
                  </td>
                  <td className="px-3 py-2">{item.status}</td>
                  <td className="px-3 py-2">{item.reason}</td>
                  <td className="px-3 py-2">
                    {session.user.role === Role.MASTER_ADMIN && item.status === GiftCardReconciliationStatus.MANUAL_REVIEW
                      ? "Resolve via API after verification"
                      : "Read-only"}
                  </td>
                </tr>
              ))}
              {cases.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-[#5a6d86]">
                    No reconciliation cases found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
