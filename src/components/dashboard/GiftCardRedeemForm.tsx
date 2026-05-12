"use client";

import { useState } from "react";

type RedeemState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; amountRedeemedMinor: number; currencyCode: string }
  | { status: "error"; message: string };

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export function GiftCardRedeemForm() {
  const [code, setCode] = useState("");
  const [state, setState] = useState<RedeemState>({ status: "idle" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;

    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/gift-cards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });

      const data = (await response.json()) as {
        newBalanceMinor?: number;
        currencyCode?: string;
        amountRedeemedMinor?: number;
        error?: string;
      };

      if (!response.ok) {
        setState({ status: "error", message: data.error ?? "Redemption failed. Please try again." });
        return;
      }

      setState({
        status: "success",
        amountRedeemedMinor: data.amountRedeemedMinor!,
        currencyCode: data.currencyCode!,
      });
      setCode("");
    } catch {
      setState({ status: "error", message: "Network error. Please try again." });
    }
  }

  return (
    <div className="rounded-xl border border-[#d8cec6] bg-white p-5 space-y-4">
      <h2 className="text-lg font-semibold text-[#6f2b2b]">Redeem a Gift Card</h2>
      <p className="text-sm text-[#5f4040]">
        Enter your gift card code to add the balance to your wallet.
      </p>

      {state.status === "success" ? (
        <div className="rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] px-4 py-3 text-sm text-[#166534]" data-testid="redeem-success">
          <p className="font-medium">Gift card redeemed successfully!</p>
          <p className="mt-1">{formatAmount(state.amountRedeemedMinor, state.currencyCode)} has been added to your wallet.</p>
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="mt-3 text-xs underline underline-offset-2 hover:opacity-80"
          >
            Redeem another code
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="gift-card-code" className="block text-xs font-medium text-[#5f4040] mb-1">
              Gift Card Code
            </label>
            <input
              id="gift-card-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
              disabled={state.status === "submitting"}
              className="w-full rounded-lg border border-[#d8cec6] px-3 py-2 text-sm font-mono text-[#3d2020] placeholder-[#c4a9a0] focus:outline-none focus:ring-2 focus:ring-[#7b2d2d] disabled:opacity-50"
              data-testid="gift-card-code-input"
            />
          </div>

          {state.status === "error" ? (
            <p className="text-sm text-[#7b2d2d]" data-testid="redeem-error">{state.message}</p>
          ) : null}

          <button
            type="submit"
            disabled={state.status === "submitting" || !code.trim()}
            className="rounded-lg bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-white hover:bg-[#6f2b2b] disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="redeem-submit"
          >
            {state.status === "submitting" ? "Redeeming…" : "Redeem Code"}
          </button>
        </form>
      )}
    </div>
  );
}
