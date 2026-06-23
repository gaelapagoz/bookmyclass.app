import Link from "next/link";
import { GiftCardLedgerEntryType } from "@prisma/client";

import { GiftCardRedeemForm } from "@/components/dashboard/GiftCardRedeemForm";
import { LoyaltyRewardRedeemForm } from "@/components/dashboard/LoyaltyRewardRedeemForm";
import { requireAuth } from "@/lib/auth/require-auth";
import { getGiftCardWalletWithHistory } from "@/lib/gift-cards/gift-card-wallet-read-service";
import { getLoyaltyCreditBalance, listActiveLoyaltyRewards } from "@/lib/loyalty/loyalty-redemption-service";
import { resolvePrimaryLoyaltyCurrencyCode } from "@/lib/loyalty/loyalty-program-service";
import { getClientLoyaltySummary, listClientLoyaltyHistory } from "@/lib/loyalty/loyalty-read-service";

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

function formatPoints(points: number): string {
  return new Intl.NumberFormat("en-BE").format(points);
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

function ledgerEntrySign(entryType: GiftCardLedgerEntryType): "+" | "-" | "" {
  switch (entryType) {
    case GiftCardLedgerEntryType.ACTIVATION: return "+";
    case GiftCardLedgerEntryType.CAPTURE: return "-";
    case GiftCardLedgerEntryType.RELEASE: return "+";
    default: return "";
  }
}

function loyaltyEntryLabel(entryType: string): string {
  switch (entryType) {
    case "EARN": return "Spend earning";
    case "MANUAL_GRANT": return "Manual grant";
    case "REDEEM": return "Reward redemption";
    case "REVERSAL": return "Financial reversal";
    case "EXPIRE": return "Expiration";
    default: return entryType;
  }
}

export default async function DashboardWalletPage() {
  const session = await requireAuth();
  const loyaltyCurrencyCode = await resolvePrimaryLoyaltyCurrencyCode();
  const [wallet, loyaltySummary, loyaltyHistory, loyaltyCredit, rewards] = await Promise.all([
    getGiftCardWalletWithHistory(session.user.id),
    getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: session.user.id },
      clientId: session.user.id,
      currencyCode: loyaltyCurrencyCode,
    }),
    listClientLoyaltyHistory({
      actor: { type: "CLIENT", userId: session.user.id },
      clientId: session.user.id,
      currencyCode: loyaltyCurrencyCode,
      limit: 20,
    }),
    getLoyaltyCreditBalance({
      clientId: session.user.id,
      currencyCode: loyaltyCurrencyCode,
    }),
    listActiveLoyaltyRewards({ currencyCode: loyaltyCurrencyCode }),
  ]);

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Wallet</h1>

      <section className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Gift Card Wallet</h2>
            <p className="mt-1 text-sm text-[#5f4040]">
              Gift-card balance stays separate from loyalty value and can still be redeemed here.
            </p>
          </div>
          <Link
            href="/store"
            className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          >
            Visit the Store
          </Link>
        </div>

        <div className="mt-5">
          <GiftCardRedeemForm />
        </div>

        {wallet === null ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#d8cec6] px-4 py-5 text-sm text-[#5f4040]">
            You have no gift card wallet balance yet.
          </div>
        ) : (
          <div className="mt-5 space-y-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
                <p className="text-xs uppercase tracking-wide text-[#8a5959]">Settled Balance</p>
                <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]" data-testid="settled-balance">
                  {formatAmount(wallet.balanceMinor, wallet.currencyCode)}
                </p>
              </article>

              <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
                <p className="text-xs uppercase tracking-wide text-[#8a5959]">Available</p>
                <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]" data-testid="available-balance">
                  {formatAmount(wallet.availableBalanceMinor, wallet.currencyCode)}
                </p>
              </article>

              <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
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
                <h3 className="text-lg font-semibold text-[#6f2b2b]">Gift Card History</h3>
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
                      {wallet.ledgerEntries.map((entry: (typeof wallet.ledgerEntries)[number]) => {
                        const sign = ledgerEntrySign(entry.entryType);
                        const isPositive = sign === "+";
                        const isNegative = sign === "-";
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
              <p className="text-sm text-[#8a5959]">No gift card transactions yet.</p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Loyalty</h2>
            <p className="mt-1 text-sm text-[#5f4040]">
              Loyalty points and loyalty credit stay separate from gift cards, but work together at checkout.
            </p>
          </div>
          <div className="rounded-lg bg-[#faf5f2] px-3 py-2 text-xs text-[#7f5a5a]">
            Separate balance from gift cards
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
            <p className="text-xs uppercase tracking-wide text-[#8a5959]">Current Points</p>
            <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">
              {formatPoints(loyaltySummary.balancePoints)}
            </p>
          </article>

          <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
            <p className="text-xs uppercase tracking-wide text-[#8a5959]">Expiring Soon</p>
            <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">
              {formatPoints(loyaltySummary.expiringPoints)}
            </p>
          </article>

          <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
            <p className="text-xs uppercase tracking-wide text-[#8a5959]">Next Expiration</p>
            <p className="mt-2 text-sm font-semibold text-[#6f2b2b]">
              {loyaltySummary.nextExpirationAt ? formatDate(loyaltySummary.nextExpirationAt) : "No scheduled expiry"}
            </p>
          </article>

          <article className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
            <p className="text-xs uppercase tracking-wide text-[#8a5959]">Loyalty Credit</p>
            <p className="mt-2 text-2xl font-semibold text-[#6f2b2b]">
              {formatAmount(loyaltyCredit.availableBalanceMinor, loyaltyCurrencyCode)}
            </p>
          </article>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-[#5f4040]">
          <p>Lifetime earned: {formatPoints(loyaltySummary.lifetimeEarnedPoints)} points</p>
          <p>Manual grants: {formatPoints(loyaltySummary.manualGrantPoints)} points</p>
          <p>Reversed: {formatPoints(loyaltySummary.reversedPoints)} points</p>
          <p>Expired: {formatPoints(loyaltySummary.expiredPoints)} points</p>
        </div>

        <div className="mt-5 rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
          <h3 className="text-lg font-semibold text-[#6f2b2b]">Redeem points</h3>
          <p className="mt-1 text-sm text-[#5f4040]">
            Convert points into loyalty credit for future one-time checkouts.
          </p>
          <div className="mt-4">
            <LoyaltyRewardRedeemForm rewards={rewards} />
          </div>
        </div>

        {loyaltyHistory.length > 0 ? (
          <section className="mt-5 space-y-2">
            <h3 className="text-lg font-semibold text-[#6f2b2b]">Loyalty History</h3>
            <div className="overflow-x-auto rounded-xl border border-[#d8cec6] bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-[#faf5f2] text-left text-xs uppercase tracking-wide text-[#8a5959]">
                  <tr>
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Activity</th>
                    <th className="px-4 py-2">Reason</th>
                    <th className="px-4 py-2 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {loyaltyHistory.map((entry: (typeof loyaltyHistory)[number]) => (
                    <tr key={entry.id} className="border-t border-[#f0e8e4] text-[#5f4040]">
                      <td className="px-4 py-2 whitespace-nowrap text-xs text-[#8a5959]">
                        {formatDate(entry.happenedAt)}
                      </td>
                      <td className="px-4 py-2">{loyaltyEntryLabel(entry.entryType)}</td>
                      <td className="px-4 py-2">{entry.reason ?? "-"}</td>
                      <td className="px-4 py-2 text-right font-mono font-medium whitespace-nowrap">
                        {formatPoints(entry.amountPoints)} pts
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <p className="mt-5 text-sm text-[#8a5959]">No loyalty activity yet.</p>
        )}
      </section>
    </section>
  );
}
