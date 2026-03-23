"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type PaymentSelectionMode = "SINGLE_SESSION" | "EXISTING_PLAN" | "NEW_PLAN_PURCHASE";

type PaymentOptionsResponse = {
  paymentOptions: {
    bookingId: string;
    bookingIntent: "SINGLE_BOOKING" | "USE_PLAN";
    singleSession: {
      amountMinor: number;
      currencyCode: string;
      priceId: string;
      priceName: string;
    } | null;
    existingPlans: Array<{
      entitlementId: string;
      productName: string;
      remainingCredits: number | null;
    }>;
    newPlanOptions: Array<{
      amountMinor: number;
      currencyCode: string;
      priceId: string;
      priceName: string;
      productName: string;
    }>;
    selected: {
      draftAmountMinor: number | null;
      draftCurrencyCode: string | null;
      paymentSelection: string | null;
      selectedEntitlementId: string | null;
      selectedPriceId: string | null;
    };
    ux: {
      recommended: {
        mode: PaymentSelectionMode | null;
        entitlementId: string | null;
        priceId: string | null;
        reason: string;
      };
      requiresChoice: boolean;
    };
  };
};

type BookingPaymentOptionsStepProps = {
  bookingId: string;
  serviceSlug: string;
};

type ApiErrorResponse = {
  error?: string;
};

type ApplyPlanResponse = {
  selection: {
    bookingStatus: string;
  };
};

type CheckoutSessionResponse = {
  checkout: {
    checkoutUrl: string;
  };
};

type Selection =
  | { mode: "SINGLE_SESSION"; priceId: string }
  | { mode: "NEW_PLAN_PURCHASE"; priceId: string }
  | { entitlementId: string; mode: "EXISTING_PLAN" }
  | null;

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function selectionFromState(input: {
  paymentSelection: string | null;
  selectedEntitlementId: string | null;
  selectedPriceId: string | null;
}): Selection {
  if (input.paymentSelection === "EXISTING_PLAN" && input.selectedEntitlementId) {
    return { mode: "EXISTING_PLAN", entitlementId: input.selectedEntitlementId };
  }

  if (input.paymentSelection === "SINGLE_SESSION" && input.selectedPriceId) {
    return { mode: "SINGLE_SESSION", priceId: input.selectedPriceId };
  }

  if (input.paymentSelection === "NEW_PLAN_PURCHASE" && input.selectedPriceId) {
    return { mode: "NEW_PLAN_PURCHASE", priceId: input.selectedPriceId };
  }

  return null;
}

function selectionFromRecommended(input: {
  recommended: {
    mode: PaymentSelectionMode | null;
    entitlementId: string | null;
    priceId: string | null;
  };
}): Selection {
  if (input.recommended.mode === "EXISTING_PLAN" && input.recommended.entitlementId) {
    return { mode: "EXISTING_PLAN", entitlementId: input.recommended.entitlementId };
  }

  if (input.recommended.mode === "SINGLE_SESSION" && input.recommended.priceId) {
    return { mode: "SINGLE_SESSION", priceId: input.recommended.priceId };
  }

  if (input.recommended.mode === "NEW_PLAN_PURCHASE" && input.recommended.priceId) {
    return { mode: "NEW_PLAN_PURCHASE", priceId: input.recommended.priceId };
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractApiErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim().length > 0) {
    return payload.error;
  }

  return fallback;
}

function isPaymentOptionsResponse(payload: unknown): payload is PaymentOptionsResponse {
  return isRecord(payload) && "paymentOptions" in payload && isRecord(payload.paymentOptions);
}

function isApplyPlanResponse(payload: unknown): payload is ApplyPlanResponse {
  return isRecord(payload) && "selection" in payload && isRecord(payload.selection);
}

function isCheckoutSessionResponse(payload: unknown): payload is CheckoutSessionResponse {
  return isRecord(payload) && "checkout" in payload && isRecord(payload.checkout) && typeof payload.checkout.checkoutUrl === "string";
}

export function BookingPaymentOptionsStep({ bookingId, serviceSlug }: BookingPaymentOptionsStepProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isPrimaryLoading, setIsPrimaryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<PaymentOptionsResponse["paymentOptions"] | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showChoices, setShowChoices] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/payment-options`);
        const payload: unknown = await response.json();
        if (!response.ok || !isPaymentOptionsResponse(payload)) {
          setErrorMessage(extractApiErrorMessage(payload, "Could not load payment options."));
          return;
        }

        setOptions(payload.paymentOptions);

        const fromStored = selectionFromState(payload.paymentOptions.selected);
        const fromRecommended = selectionFromRecommended({
          recommended: payload.paymentOptions.ux.recommended,
        });
        setSelection(fromStored ?? fromRecommended);
      } catch {
        setErrorMessage("Could not load payment options.");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [bookingId]);

  const selectedPlan = useMemo(() => {
    if (!options || !selection || selection.mode !== "EXISTING_PLAN") {
      return null;
    }

    return options.existingPlans.find((plan) => plan.entitlementId === selection.entitlementId) ?? null;
  }, [options, selection]);

  const selectedPrice = useMemo(() => {
    if (!options || !selection || selection.mode === "EXISTING_PLAN") {
      return null;
    }

    if (selection.mode === "SINGLE_SESSION" && options.singleSession?.priceId === selection.priceId) {
      return {
        label: options.singleSession.priceName,
        amountMinor: options.singleSession.amountMinor,
        currencyCode: options.singleSession.currencyCode,
      };
    }

    const planPrice = options.newPlanOptions.find((plan) => plan.priceId === selection.priceId);
    if (!planPrice) {
      return null;
    }

    return {
      label: `${planPrice.productName} - ${planPrice.priceName}`,
      amountMinor: planPrice.amountMinor,
      currencyCode: planPrice.currencyCode,
    };
  }, [options, selection]);

  const primaryLabel = useMemo(() => {
    if (!selection) {
      return "Choose an option";
    }

    if (selection.mode === "EXISTING_PLAN") {
      return "Use Plan And Confirm Booking";
    }

    if (selectedPrice) {
      return `Pay ${formatMoney(selectedPrice.amountMinor, selectedPrice.currencyCode)}`;
    }

    return "Continue to payment";
  }, [selection, selectedPrice]);

  const handlePrimaryAction = async () => {
    if (!selection) {
      setErrorMessage("Select a payment option first.");
      return;
    }

    setIsPrimaryLoading(true);
    setErrorMessage(null);

    try {
      const applyBody =
        selection.mode === "EXISTING_PLAN"
          ? { mode: "EXISTING_PLAN", entitlementId: selection.entitlementId }
          : { mode: selection.mode, priceId: selection.priceId };

      const applyResponse = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/apply-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(applyBody),
      });

      const applyPayload = (await applyResponse.json()) as
        | ApplyPlanResponse
        | ApiErrorResponse;
      if (!applyResponse.ok || !isApplyPlanResponse(applyPayload)) {
        setErrorMessage(extractApiErrorMessage(applyPayload, "Could not apply payment selection."));
        return;
      }

      if (selection.mode === "EXISTING_PLAN") {
        router.push(`/book-a-class/${serviceSlug}/confirmed?bookingId=${bookingId}`);
        return;
      }

      const checkoutResponse = await fetch("/api/checkout/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });

      const checkoutPayload: unknown = await checkoutResponse.json();
      if (!checkoutResponse.ok || !isCheckoutSessionResponse(checkoutPayload)) {
        setErrorMessage(extractApiErrorMessage(checkoutPayload, "Could not start checkout."));
        return;
      }

      window.location.assign(checkoutPayload.checkout.checkoutUrl);
    } catch {
      setErrorMessage("Could not continue with payment.");
    } finally {
      setIsPrimaryLoading(false);
    }
  };

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <div className="h-56 animate-pulse rounded-xl border border-[#d8cec6] bg-[#f2ede7]" />
      </section>
    );
  }

  if (!options) {
    return (
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Payment</h1>
        <p className="mt-3 text-sm text-[#7b2d2d]">{errorMessage ?? "Payment options are unavailable."}</p>
      </section>
    );
  }

  const showChoiceUi = options.ux.requiresChoice || showChoices;
  const showNoPlanHint =
    options.bookingIntent === "USE_PLAN" && options.existingPlans.length === 0;

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Payment</h1>
      <p className="mt-2 text-sm text-[#7f5a5a]">{options.ux.recommended.reason}</p>
      <p className="mt-1 text-xs text-[#7f5a5a]">Card details are entered securely on Stripe checkout when payment is required.</p>
      {showNoPlanHint ? (
        <p className="mt-3 text-sm text-[#7b2d2d]">
          No eligible active plan found for this booking. Choose a plan purchase or continue with single-session payment.
        </p>
      ) : null}

      {!showChoiceUi ? (
        <div className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5 text-sm text-[#5f4040]">
          <p className="font-medium text-[#6f2b2b]">Selected payment path</p>
          {selection?.mode === "EXISTING_PLAN" && selectedPlan ? (
            <p className="mt-2">Use plan: {selectedPlan.productName}{selectedPlan.remainingCredits !== null ? ` (${selectedPlan.remainingCredits} credits)` : ""}</p>
          ) : selectedPrice ? (
            <p className="mt-2">{selectedPrice.label} ({formatMoney(selectedPrice.amountMinor, selectedPrice.currencyCode)})</p>
          ) : (
            <p className="mt-2">No option selected yet.</p>
          )}
          {options.bookingIntent === "USE_PLAN" &&
          (options.existingPlans.length > 1 ||
            options.newPlanOptions.length > 1 ||
            (options.existingPlans.length === 0 && options.singleSession !== null)) ? (
            <button
              type="button"
              onClick={() => setShowChoices(true)}
              className="mt-4 text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
            >
              Change option
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {options.singleSession ? (
            <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
              <h2 className="text-lg font-semibold text-[#6f2b2b]">Single Session</h2>
              <label className="mt-3 flex items-center gap-2 text-sm text-[#5f4040]">
                <input
                  type="radio"
                  name="payment-option"
                  checked={selection?.mode === "SINGLE_SESSION" && selection.priceId === options.singleSession?.priceId}
                  onChange={() => setSelection({ mode: "SINGLE_SESSION", priceId: options.singleSession!.priceId })}
                />
                <span>{options.singleSession.priceName} ({formatMoney(options.singleSession.amountMinor, options.singleSession.currencyCode)})</span>
              </label>
            </div>
          ) : null}

          <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Use Existing Plan / Credits</h2>
            {options.existingPlans.length === 0 ? (
              <p className="mt-3 text-sm text-[#7f5a5a]">No active eligible plan found for this booking.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {options.existingPlans.map((plan) => (
                  <label key={plan.entitlementId} className="flex items-start gap-2 text-sm text-[#5f4040]">
                    <input
                      type="radio"
                      name="payment-option"
                      checked={selection?.mode === "EXISTING_PLAN" && selection.entitlementId === plan.entitlementId}
                      onChange={() => setSelection({ mode: "EXISTING_PLAN", entitlementId: plan.entitlementId })}
                    />
                    <span>{plan.productName}{plan.remainingCredits !== null ? ` (${plan.remainingCredits} credits)` : ""}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Buy New Plan</h2>
            {options.newPlanOptions.length === 0 ? (
              <p className="mt-3 text-sm text-[#7f5a5a]">No plan purchase option available for this booking.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {options.newPlanOptions.map((plan) => (
                  <label key={plan.priceId} className="flex items-start gap-2 text-sm text-[#5f4040]">
                    <input
                      type="radio"
                      name="payment-option"
                      checked={selection?.mode === "NEW_PLAN_PURCHASE" && selection.priceId === plan.priceId}
                      onChange={() => setSelection({ mode: "NEW_PLAN_PURCHASE", priceId: plan.priceId })}
                    />
                    <span>{plan.productName} - {plan.priceName} ({formatMoney(plan.amountMinor, plan.currencyCode)})</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {errorMessage ? <p className="mt-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/book-a-class/${serviceSlug}`}
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to availability
        </Link>
        <button
          type="button"
          onClick={handlePrimaryAction}
          disabled={isPrimaryLoading || !selection}
          className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
        >
          {isPrimaryLoading ? "Processing..." : primaryLabel}
        </button>
      </div>
    </section>
  );
}
