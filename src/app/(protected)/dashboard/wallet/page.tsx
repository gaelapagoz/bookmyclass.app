import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { getGiftCardWalletWithHistory } from "@/lib/gift-cards/gift-card-wallet-service";
import { GiftCardLedgerEntryType } from "@prisma/client";
import { GiftCardRedeemForm } from "@/components/dashboard/GiftCardRedeemForm";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function ledgerEntryLabel(entryType: GiftCardLedgerEntryType): string {
  switch (entryType) {
    case GiftCardLedgerEntryType.ACTIVATION: return "Gift card activated";
    case GiftCardLedgerEntryType.RESERVE: return "Reserved for checkout";
    case GiftCardLedgerEntryType.CAPTURE: return "Redeemed";
    case GiftCardLedgerEntryType.RELEASE: return "Reservation released";
    default: return entryType;
  }
}

function ledgerEntrySign(entryType: GiftCardLedgerEntryType): "+" | "−" | "" {
  switch (entryType) {
    case GiftCardLedgerEntryType.ACTIVATION: return "+";
    case GiftCardLedgerEntryType.CAPTURE: return "−";
    case GiftCardLedgerEntryType.RELEASE: return "+";
    default: return "";
  }
}

export default async function DashboardWalletPage() {
  const session = await requireAuth();
  const wallet = await getGiftCardWalletWithHistory(session.user.id);

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Gift Card Wallet</h1>

      <GiftCardRedeemForm />

      {wallet === null ? (
        <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
          <p className="text-sm text-[#5f4040]">
            You have no gift card wallet balance yet.
          </p>
          <Link
            href="/store"
            className="mt-3 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          >
            Visit the Store
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#8a5959]">Settled Balance</p>
              <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]" data-testid="settled-balance">
                {formatAmount(wallet.balanceMinor, wallet.currencyCode)}
              </p>
            </article>

            <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#8a5959]">Available</p>
              <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]" data-testid="available-balance">
                {formatAmount(wallet.availableBalanceMinor, wallet.currencyCode)}
              </p>
            </article>

            <article className="rounded-xl border border-[#d8cec6] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#8a5959]">Reserved</p>
              <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]" data-testid="reserved-balance">
                {formatAmount(wallet.reservedAmountMinor, wallet.currencyCode)}
              </p>
            </article>
          </div>

          {wallet.reservedAmountMinor > 0 ? (
            <p className="text-xs text-[#7f5a5a]">
              Reserved amount is held for an active pending checkout and will be released or captured when that order settles.
            </p>
          ) : null}

          {wallet.ledgerEntries.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold text-[#6f2b2b]">Transaction History</h2>
              <div className="overflow-x-auto rounded-xl border border-[#d8cec6] bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#faf5f2] text-left text-xs uppercase tracking-wide text-[#8a5959]">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Description</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wallet.ledgerEntries.map((entry) => {
                      const sign = ledgerEntrySign(entry.entryType);
                      const isPositive = sign === "+";
                      const isNegative = sign === "−";
                      return (
                        <tr key={entry.id} className="border-t border-[#f0e8e4] text-[#5f4040]">
                          <td className="px-4 py-2 whitespace-nowrap text-xs text-[#8a5959]">
                            {formatDate(entry.happenedAt)}
                          </td>
                          <td className="px-4 py-2">{ledgerEntryLabel(entry.entryType)}</td>
                          <td className={`px-4 py-2 text-right font-mono font-medium whitespace-nowrap ${isPositive ? "text-[#166534]" : isNegative ? "text-[#7b2d2d]" : "text-[#5f4040]"}`}>
                            {sign}{formatAmount(entry.amountMinor, entry.currencyCode)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="text-sm text-[#8a5959]">No transactions yet.</p>
          )}

          <div className="mt-2">
            <Link
              href="/store"
              className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
            >
              Visit the Store
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
