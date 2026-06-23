"use client";

import { useState } from "react";

type LoyaltyReward = {
  id: string;
  name: string;
  pointsRequired: number;
  amountMinor: number;
  currencyCode: string;
  isActive: boolean;
};

function formatAmount(minor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function LoyaltyRewardRedeemForm(props: {
  rewards: LoyaltyReward[];
}) {
  const [selectedReward, setSelectedReward] = useState<LoyaltyReward | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function redeemReward() {
    if (!selectedReward) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/loyalty/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rewardDefinitionId: selectedReward.id }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setFeedback(payload.message ?? "Could not redeem loyalty reward.");
        return;
      }

      window.location.reload();
    } catch {
      setFeedback("Could not redeem loyalty reward.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (props.rewards.length === 0) {
    return <p className="text-sm text-[#8a5959]">No loyalty rewards are available right now.</p>;
  }

  return (
    <div className="space-y-3">
      {feedback ? <p className="text-sm text-[#7b2d2d]">{feedback}</p> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {props.rewards.map((reward) => (
          <article key={reward.id} className="rounded-xl border border-[#d8cec6] bg-[#fffdfb] p-4">
            <h3 className="text-base font-semibold text-[#6f2b2b]">{reward.name}</h3>
            <p className="mt-1 text-sm text-[#5f4040]">
              {reward.pointsRequired} points for {formatAmount(reward.amountMinor, reward.currencyCode)} loyalty credit
            </p>
            <button
              type="button"
              onClick={() => setSelectedReward(reward)}
              className="mt-3 rounded-full border border-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#7b2d2d]"
            >
              Redeem
            </button>
          </article>
        ))}
      </div>

      {selectedReward ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/35 px-4 py-8">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Redeem loyalty reward"
            className="w-full max-w-lg rounded-2xl border border-[#d8cec6] bg-white p-6 shadow-[0_18px_60px_rgba(15,23,42,0.2)]"
          >
            <h2 className="text-xl font-semibold text-[#6f2b2b]">{selectedReward.name}</h2>
            <p className="mt-3 text-sm text-[#5f4040]">
              Redeem {selectedReward.pointsRequired} points for {formatAmount(selectedReward.amountMinor, selectedReward.currencyCode)} loyalty credit?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedReward(null)}
                className="rounded-full border border-[#d8cec6] px-4 py-2 text-sm text-[#5f4040]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void redeemReward()}
                disabled={isSubmitting}
                className="rounded-full bg-[#7b2d2d] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isSubmitting ? "Redeeming..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
