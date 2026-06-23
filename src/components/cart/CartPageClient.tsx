"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PriceType } from "@prisma/client";
import { SignInModal } from "@/components/book-a-class/service-detail/SignInModal";
import {
  ClientCartLine,
  generateCartCheckoutIdempotencyKey,
  getCheckoutSubmissionFingerprint,
  getClientCartSubtotalMinor,
  rememberClientCartSnapshotForCheckoutSession,
  replaceClientCartWithServerLines,
  readClientCart,
  removeClientCartLine,
  subscribeToClientCart,
  updateClientCartLineQuantity,
  validateClientCart,
} from "@/lib/cart/cart-client";
import {
  CART_CHECKOUT_MAX_LOYALTY_CREDIT_AMOUNT_MINOR,
  CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR,
} from "@/lib/cart/cart-contract";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

type WalletBalance = {
  balanceMinor: number;
  availableBalanceMinor: number;
  reservedAmountMinor: number;
  currencyCode: string;
};

type LoyaltyCreditBalance = {
  settledBalanceMinor: number;
  reservedAmountMinor: number;
  availableBalanceMinor: number;
  currencyCode: string;
};

type CheckoutApiPayload = {
  type?: string;
  code?: string;
  message?: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  redirectUrl?: string;
  orderId?: string;
  retryAfterMs?: number;
  idempotency?: {
    state?: string;
  };
};

type CartReconcileApiPayload = {
  lines?: ClientCartLine[];
  removedCount?: number;
};

const IN_PROGRESS_RETRY_DELAY_MS = 150;
const MAX_IN_PROGRESS_ATTEMPTS = 4;
const CART_CHECKOUT_DEBUG =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_CART_CHECKOUT_DEBUG === "1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function debugLog(event: string, payload: Record<string, unknown>) {
  if (!CART_CHECKOUT_DEBUG) {
    return;
  }
  try {
    console.info(`[cart-checkout-debug] ui_${event} ${JSON.stringify(payload)}`);
  } catch {
    console.info(`[cart-checkout-debug] ui_${event}`, payload);
  }
}

function hasOneTimeItems(lines: ClientCartLine[]): boolean {
  return lines.some((line) => line.priceType === PriceType.ONE_TIME);
}

function hasRecurringOnlyItems(lines: ClientCartLine[]): boolean {
  return lines.length > 0 && lines.every((line) => line.priceType === PriceType.RECURRING);
}

export function CartPageClient() {
  const [lines, setLines] = useState<ClientCartLine[]>([]);
  const [clientCartVersion, setClientCartVersion] = useState<number>(1);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showVerifyEmailAction, setShowVerifyEmailAction] = useState(false);
  const [submissionState, setSubmissionState] = useState<{ key: string; fingerprint: string } | null>(null);
  const [walletBalance, setWalletBalance] = useState<WalletBalance | null>(null);
  const [walletAmountMinor, setWalletAmountMinor] = useState<number>(0);
  const [walletInputValue, setWalletInputValue] = useState<string>("");
  const [loyaltyBalance, setLoyaltyBalance] = useState<LoyaltyCreditBalance | null>(null);
  const [loyaltyCreditAmountMinor, setLoyaltyCreditAmountMinor] = useState<number>(0);
  const [loyaltyInputValue, setLoyaltyInputValue] = useState<string>("");
  const [couponInput, setCouponInput] = useState<string>("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<
    | null
    | {
        couponCode: string;
        discountAmountMinor: number;
        totalAmountMinor: number;
        currencyCode: string;
      }
  >(null);

  useEffect(() => {
    const sync = () => {
      const state = readClientCart();
      setLines(state.lines);
      setClientCartVersion(state.version);
    };

    sync();
    setIsHydrated(true);
    return subscribeToClientCart(sync);
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    async function fetchWalletBalance() {
      try {
        const [walletResponse, loyaltyResponse] = await Promise.all([
          fetch("/api/wallet/balance"),
          fetch("/api/loyalty/wallet"),
        ]);
        if (walletResponse.ok) {
          const data = (await walletResponse.json()) as { balance: WalletBalance | null };
          setWalletBalance(data.balance ?? null);
        }
        if (loyaltyResponse.ok) {
          const data = (await loyaltyResponse.json()) as {
            loyalty: { loyaltyCredit: LoyaltyCreditBalance } | null;
          };
          setLoyaltyBalance(data.loyalty?.loyaltyCredit ?? null);
        }
      } catch {
        // wallet balance fetch failure is non-blocking
      }
    }

    void fetchWalletBalance();
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated || lines.length === 0) {
      return;
    }

    let cancelled = false;
    const currentFingerprint = getCheckoutSubmissionFingerprint(lines);

    async function reconcileCart() {
      try {
        const response = await fetch("/api/cart/reconcile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            lines: lines.map((line) => ({
              productId: line.productId,
              priceId: line.priceId,
              quantity: line.quantity,
            })),
          }),
        });

        if (!response.ok || cancelled) {
          return;
        }

        const payload = (await response.json()) as CartReconcileApiPayload;
        if (!Array.isArray(payload.lines)) {
          return;
        }

        const nextFingerprint = getCheckoutSubmissionFingerprint(payload.lines);
        if (nextFingerprint !== currentFingerprint) {
          const next = replaceClientCartWithServerLines(payload.lines);
          setLines(next.lines);
          setClientCartVersion(next.version);
        }

        if ((payload.removedCount ?? 0) > 0) {
          setFeedback("Unavailable cart items were removed.");
          setSubmissionState(null);
        }
      } catch {
        // Keep the local cart usable if reconciliation is temporarily unavailable.
      }
    }

    void reconcileCart();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, lines]);

  const subtotalMinor = useMemo(() => getClientCartSubtotalMinor(lines), [lines]);
  const subtotalCurrency = lines[0]?.currencyCode ?? "EUR";
  const validation = useMemo(() => validateClientCart({ lines }), [lines]);
  const fingerprint = useMemo(() => getCheckoutSubmissionFingerprint(lines), [lines]);
  const discountedSubtotalMinor = appliedCoupon?.totalAmountMinor ?? subtotalMinor;
  const totalMinor = Math.max(0, discountedSubtotalMinor - loyaltyCreditAmountMinor - walletAmountMinor);

  const fingerprintWithCoupon = useMemo(() => {
    return appliedCoupon ? `${fingerprint}|coupon=${appliedCoupon.couponCode}` : fingerprint;
  }, [fingerprint, appliedCoupon]);

  const showWalletControls =
    isHydrated &&
    walletBalance !== null &&
    walletBalance.availableBalanceMinor > 0 &&
    hasOneTimeItems(lines);
  const showLoyaltyControls =
    isHydrated &&
    loyaltyBalance !== null &&
    loyaltyBalance.availableBalanceMinor > 0 &&
    hasOneTimeItems(lines);

  const showRecurringWalletNote =
    isHydrated &&
    walletBalance !== null &&
    walletBalance.availableBalanceMinor > 0 &&
    hasRecurringOnlyItems(lines);
  const showRecurringLoyaltyNote =
    isHydrated &&
    loyaltyBalance !== null &&
    loyaltyBalance.availableBalanceMinor > 0 &&
    hasRecurringOnlyItems(lines);

  const maxApplicableWallet = showWalletControls
    ? Math.min(
        walletBalance.availableBalanceMinor,
        Math.max(0, discountedSubtotalMinor - loyaltyCreditAmountMinor),
        CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR,
      )
    : 0;
  const maxApplicableLoyalty = showLoyaltyControls
    ? Math.min(
        loyaltyBalance.availableBalanceMinor,
        discountedSubtotalMinor,
        CART_CHECKOUT_MAX_LOYALTY_CREDIT_AMOUNT_MINOR,
      )
    : 0;

  const checkoutDisabled = !validation.ok || lines.length === 0 || isSubmitting;

  const applyWallet = () => {
    const parsed = Math.round(parseFloat(walletInputValue) * 100);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFeedback("Enter a valid wallet amount in EUR.");
      return;
    }
    if (parsed > maxApplicableWallet) {
      setFeedback(`Maximum applicable wallet amount is ${formatAmount(maxApplicableWallet, "EUR")}.`);
      return;
    }
    setWalletAmountMinor(parsed);
    setFeedback(null);
  };

  const removeWallet = () => {
    setWalletAmountMinor(0);
    setWalletInputValue("");
    setFeedback(null);
  };

  const applyLoyaltyCredit = () => {
    const parsed = Math.round(parseFloat(loyaltyInputValue) * 100);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFeedback("Enter a valid loyalty credit amount in EUR.");
      return;
    }
    if (parsed > maxApplicableLoyalty) {
      setFeedback(`Maximum applicable loyalty credit is ${formatAmount(maxApplicableLoyalty, "EUR")}.`);
      return;
    }
    setLoyaltyCreditAmountMinor(parsed);
    setFeedback(null);
  };

  const removeLoyaltyCredit = () => {
    setLoyaltyCreditAmountMinor(0);
    setLoyaltyInputValue("");
    setFeedback(null);
  };

  const incrementLine = (line: ClientCartLine) => {
    const result = updateClientCartLineQuantity({
      productId: line.productId,
      priceId: line.priceId,
      quantity: line.quantity + 1,
    });
    if (!result.ok) {
      setFeedback(result.message);
      return;
    }
    setFeedback(null);
  };

  const decrementLine = (line: ClientCartLine) => {
    const result = updateClientCartLineQuantity({
      productId: line.productId,
      priceId: line.priceId,
      quantity: line.quantity - 1,
    });
    if (!result.ok) {
      setFeedback(result.message);
      return;
    }
    setFeedback(null);
  };

  const removeLine = (line: ClientCartLine) => {
    removeClientCartLine({
      productId: line.productId,
      priceId: line.priceId,
    });
    setFeedback(null);
  };

  const startCheckout = async () => {
    if (checkoutDisabled) {
      return;
    }

    const key =
      submissionState && submissionState.fingerprint === fingerprintWithCoupon
        ? submissionState.key
        : generateCartCheckoutIdempotencyKey();
    debugLog("checkout_click", {
      keySource: submissionState && submissionState.fingerprint === fingerprint ? "reused" : "generated",
      idempotencyKey: key,
      fingerprint: fingerprintWithCoupon,
      lineCount: lines.length,
      clientCartVersion,
      walletAmountMinor,
    });

    setSubmissionState({ key, fingerprint: fingerprintWithCoupon });
    setFeedback(null);
    setShowVerifyEmailAction(false);

    setIsSubmitting(true);
    try {
      const requestBody = JSON.stringify({
        lines: lines.map((line) => ({
          productId: line.productId,
          priceId: line.priceId,
          quantity: line.quantity,
        })),
        clientCartVersion: `v${clientCartVersion}`,
        ...(walletAmountMinor > 0 ? { walletAmountMinor } : {}),
        ...(loyaltyCreditAmountMinor > 0 ? { loyaltyCreditAmountMinor } : {}),
        ...(appliedCoupon ? { couponCode: appliedCoupon.couponCode } : {}),
      });

      for (let attempt = 0; attempt < MAX_IN_PROGRESS_ATTEMPTS; attempt += 1) {
        debugLog("request_attempt", {
          idempotencyKey: key,
          attempt: attempt + 1,
          maxAttempts: MAX_IN_PROGRESS_ATTEMPTS,
          fingerprint,
          walletAmountMinor,
        });
        const response = await fetch("/api/cart/checkout", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "Idempotency-Key": key,
          },
          body: requestBody,
        });

        let payload: CheckoutApiPayload = {};
        try {
          payload = (await response.json()) as CheckoutApiPayload;
        } catch {
          payload = {};
        }
        debugLog("response_received", {
          idempotencyKey: key,
          attempt: attempt + 1,
          status: response.status,
          type: payload.type ?? null,
          code: payload.code ?? null,
          idempotencyState: payload.idempotency?.state ?? null,
          retryAfterMs: payload.retryAfterMs ?? null,
        });

        if (response.status === 200 && payload.type === "completed" && payload.redirectUrl) {
          const completedOrderId = typeof payload.orderId === "string" ? payload.orderId : null;
          if (completedOrderId) {
            rememberClientCartSnapshotForCheckoutSession({
              checkoutSessionId: completedOrderId,
              fingerprint: fingerprintWithCoupon,
            });
          }
          window.location.assign(payload.redirectUrl);
          return;
        }

        if (response.status === 200 && payload.checkoutUrl) {
          if (typeof payload.checkoutSessionId === "string" && payload.checkoutSessionId.trim()) {
            rememberClientCartSnapshotForCheckoutSession({
              checkoutSessionId: payload.checkoutSessionId,
              fingerprint: fingerprintWithCoupon,
            });
          }
          window.location.assign(payload.checkoutUrl);
          return;
        }

        if (response.status === 202 && payload.code === "IDEMPOTENCY_IN_PROGRESS") {
          const retryAfterMs =
            typeof payload.retryAfterMs === "number" && Number.isFinite(payload.retryAfterMs)
              ? Math.max(100, Math.min(5000, Math.floor(payload.retryAfterMs)))
              : IN_PROGRESS_RETRY_DELAY_MS;
          if (attempt < MAX_IN_PROGRESS_ATTEMPTS - 1) {
            await sleep(retryAfterMs);
            continue;
          }
          if (payload.idempotency?.state === "FAILED_STRIPE_UNCERTAIN") {
            setFeedback(
              "Checkout confirmation is delayed with our payment provider. Please wait a moment and try checkout again.",
            );
            setSubmissionState(null);
            debugLog("submission_state_reset", {
              reason: "failed_stripe_uncertain_retry_exhausted",
              status: response.status,
              code: payload.code ?? null,
              idempotencyState: payload.idempotency?.state ?? null,
            });
            return;
          }
          setFeedback(payload.message ?? "Checkout request is being processed.");
          return;
        }

        if (response.status === 401 && payload.code === "AUTH_REQUIRED") {
          setShowSignInModal(true);
          return;
        }

        if (response.status === 403 && payload.code === "EMAIL_VERIFICATION_REQUIRED") {
          setShowVerifyEmailAction(true);
          setFeedback(payload.message ?? "Please verify your email before checkout.");
          setSubmissionState(null);
          debugLog("submission_state_reset", {
            reason: "email_verification_required",
          });
          return;
        }

        setFeedback(payload.message ?? "Could not start checkout.");
        setSubmissionState(null);
        debugLog("submission_state_reset", {
          reason: "terminal_failure_response",
          status: response.status,
          code: payload.code ?? null,
          idempotencyState: payload.idempotency?.state ?? null,
        });
        return;
      }
    } catch {
      setFeedback("Could not start checkout.");
      setSubmissionState(null);
      debugLog("submission_state_reset", {
        reason: "request_exception",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isHydrated) {
    return (
      <section className="mx-auto w-full max-w-6xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Your Cart</h1>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Your Cart</h1>
        <Link
          href="/subscription"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Continue shopping
        </Link>
      </div>

      {feedback ? <p className="mt-4 text-sm text-[#7b2d2d]">{feedback}</p> : null}
      {!validation.ok ? <p className="mt-2 text-sm text-[#7b2d2d]">{validation.message}</p> : null}
      {showVerifyEmailAction ? (
        <p className="mt-2 text-sm text-[#7f5a5a]">
          <Link
            href={`/verify-email?callbackUrl=${encodeURIComponent("/cart")}`}
            className="font-medium text-[#7b2d2d] underline underline-offset-4"
          >
            Verify your email
          </Link>
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] lg:items-start">
        <div className="rounded-xl border border-[#d8cec6] bg-white p-4">
          <div>
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Your items</h2>
          </div>

          {lines.length === 0 ? (
            <div className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5 text-sm text-[#5f4040]">
              Your cart is empty.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {lines.map((line) => {
                const isRecurring = line.priceType === PriceType.RECURRING;
                return (
                  <article
                    key={`${line.productId}:${line.priceId}`}
                    className="rounded-xl border border-[#d8cec6] bg-white p-4"
                  >
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div>
                        <h3 className="text-base font-semibold text-[#6f2b2b]">{line.productName}</h3>
                        <p className="text-sm text-[#5f4040]">{line.priceName}</p>
                        {line.productDescription ? (
                          <p className="mt-1 text-sm text-[#5f4040]">{line.productDescription}</p>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#f2ede7] px-3 py-1 text-xs font-medium text-[#7f5a5a]">
                            {isRecurring ? "Recurring product" : "One-time product"}
                          </span>
                          <span className="rounded-full bg-[#f2ede7] px-3 py-1 text-xs font-medium text-[#7f5a5a]">
                            Quantity {line.quantity}
                          </span>
                        </div>
                      </div>

                      <div className="grid min-w-[150px] gap-3 md:justify-items-end">
                        <p className="text-sm font-medium text-[#6f2b2b]">
                          {formatAmount(line.unitAmountMinor * line.quantity, line.currencyCode)}
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => decrementLine(line)}
                            disabled={isRecurring}
                            className="h-8 w-8 rounded border border-[#d8cec6] text-sm text-[#6f2b2b] disabled:opacity-50"
                            aria-label={`Decrease quantity for ${line.productName}`}
                          >
                            -
                          </button>
                          <span className="min-w-8 text-center text-sm text-[#5f4040]">{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() => incrementLine(line)}
                            disabled={isRecurring}
                            className="h-8 w-8 rounded border border-[#d8cec6] text-sm text-[#6f2b2b] disabled:opacity-50"
                            aria-label={`Increase quantity for ${line.productName}`}
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeLine(line)}
                          className="text-sm text-[#7b2d2d] underline underline-offset-4"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="rounded-xl border border-[#d8cec6] bg-white lg:sticky lg:top-6">
          <div className="border-b border-[#d8cec6] px-4 py-4">
            <h2 className="text-lg font-semibold text-[#6f2b2b]">Order summary</h2>
            <div className="mt-4 space-y-2 text-sm text-[#5f4040]">
              <div className="flex items-center justify-between gap-4">
                <span>Items</span>
                <span className="font-medium text-[#6f2b2b]">{formatAmount(subtotalMinor, subtotalCurrency)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Discounts</span>
                <span className="font-medium text-[#6f2b2b]">
                  {appliedCoupon
                    ? `- ${formatAmount(appliedCoupon.discountAmountMinor, appliedCoupon.currencyCode)}`
                    : formatAmount(0, subtotalCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Loyalty credit</span>
                <span className="font-medium text-[#6f2b2b]">
                  {loyaltyCreditAmountMinor > 0
                    ? `- ${formatAmount(loyaltyCreditAmountMinor, "EUR")}`
                    : formatAmount(0, subtotalCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Gift card</span>
                <span className="font-medium text-[#6f2b2b]">
                  {walletAmountMinor > 0
                    ? `- ${formatAmount(walletAmountMinor, "EUR")}`
                    : formatAmount(0, subtotalCurrency)}
                </span>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#d8cec6] pt-4">
              <span className="text-base font-semibold text-[#6f2b2b]">Total</span>
              <span className="text-2xl font-semibold text-[#6f2b2b]">
                {formatAmount(totalMinor, subtotalCurrency)}
              </span>
            </div>
            <p className="mt-2 text-xs text-[#7f5a5a]">Taxes and applicable fees are included where relevant.</p>
          </div>

          <div className="border-b border-[#d8cec6] px-4 py-4" data-testid="coupon-block">
            <label htmlFor="coupon-code" className="block text-sm font-semibold text-[#6f2b2b]">
              Coupon code
            </label>
            {appliedCoupon ? (
              <div className="mt-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-[#5f4040]">
                    Applied: <span className="font-semibold">{appliedCoupon.couponCode}</span>
                  </p>
                  <p className="mt-1 text-xs text-[#7f5a5a]">
                    Discount: {formatAmount(appliedCoupon.discountAmountMinor, appliedCoupon.currencyCode)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null);
                    setCouponInput("");
                    setCouponError(null);
                    try {
                      window.localStorage.removeItem("studio_cart_applied_coupon_v1");
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-xs text-[#7b2d2d] underline underline-offset-2"
                  data-testid="coupon-remove"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  id="coupon-code"
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  placeholder="Enter coupon code"
                  className="rounded border border-[#d8cec6] px-3 py-2 text-sm text-[#5f4040] outline-none"
                  data-testid="coupon-input"
                />
                <button
                  type="button"
                  onClick={async () => {
                    setCouponLoading(true);
                    setCouponError(null);
                    try {
                      const resp = await fetch("/api/cart/coupon/validate", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          lines: lines.map((line) => ({
                            productId: line.productId,
                            priceId: line.priceId,
                            quantity: line.quantity,
                          })),
                          couponCode: couponInput,
                        }),
                      });
                      if (resp.status === 401) {
                        setShowSignInModal(true);
                        return;
                      }
                      if (resp.status === 403) {
                        setShowVerifyEmailAction(true);
                        setCouponError("Please verify your email before applying a coupon.");
                        return;
                      }
                      const payload = await resp.json();
                      if (!resp.ok) {
                        setCouponError(payload.message ?? "Could not validate coupon.");
                        return;
                      }
                      const normalized = payload.couponCode ?? couponInput.trim().toUpperCase();
                      setAppliedCoupon({
                        couponCode: normalized,
                        discountAmountMinor: payload.discountAmountMinor ?? 0,
                        totalAmountMinor: payload.totalAmountMinor ?? payload.subtotalAmountMinor ?? 0,
                        currencyCode: payload.currencyCode ?? subtotalCurrency,
                      });
                      setCouponError(null);
                      try {
                        window.localStorage.setItem(
                          "studio_cart_applied_coupon_v1",
                          JSON.stringify({ couponCode: normalized }),
                        );
                      } catch {
                        // ignore localStorage failures
                      }
                    } catch {
                      setCouponError("Could not validate coupon.");
                    } finally {
                      setCouponLoading(false);
                    }
                  }}
                  disabled={!couponInput || couponLoading}
                  className="rounded-md border border-[#7b2d2d] px-4 py-2 text-sm text-[#7b2d2d] hover:bg-[#f2ede7] disabled:opacity-60"
                  data-testid="coupon-apply"
                >
                  {couponLoading ? "Applying..." : "Apply"}
                </button>
              </div>
            )}
            {couponError ? (
              <p className="mt-2 text-xs text-[#7b2d2d]" data-testid="coupon-error">
                {couponError}
              </p>
            ) : null}
          </div>

          {showLoyaltyControls ? (
            <div className="border-b border-[#d8cec6] px-4 py-4" data-testid="loyalty-controls">
              <h2 className="text-sm font-semibold text-[#6f2b2b]">Loyalty credit</h2>
              <p className="mt-1 text-xs text-[#7f5a5a]">
                Available: {formatAmount(loyaltyBalance.availableBalanceMinor, "EUR")}
              </p>
              {loyaltyCreditAmountMinor > 0 ? (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <span className="text-sm text-[#5f4040]" data-testid="loyalty-applied-amount">
                    Applied: {formatAmount(loyaltyCreditAmountMinor, "EUR")}
                  </span>
                  <button
                    type="button"
                    onClick={removeLoyaltyCredit}
                    className="text-xs text-[#7b2d2d] underline underline-offset-2"
                    data-testid="loyalty-remove"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <label htmlFor="loyalty-amount" className="block text-xs text-[#7f5a5a]">
                    Amount (EUR)
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      id="loyalty-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={(maxApplicableLoyalty / 100).toFixed(2)}
                      value={loyaltyInputValue}
                      onChange={(e) => setLoyaltyInputValue(e.target.value)}
                      placeholder="0.00"
                      className="rounded border border-[#d8cec6] px-3 py-2 text-sm text-[#5f4040] outline-none"
                      data-testid="loyalty-amount-input"
                    />
                    <button
                      type="button"
                      onClick={applyLoyaltyCredit}
                      className="rounded-md border border-[#7b2d2d] px-4 py-2 text-sm text-[#7b2d2d] hover:bg-[#f2ede7]"
                      data-testid="loyalty-apply"
                    >
                      Apply
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setLoyaltyInputValue((maxApplicableLoyalty / 100).toFixed(2));
                    }}
                    className="text-xs text-[#7b2d2d] underline underline-offset-2"
                    data-testid="loyalty-use-all"
                  >
                    Use all available
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {showRecurringLoyaltyNote ? (
            <div className="border-b border-[#d8cec6] px-4 py-4" data-testid="loyalty-recurring-note">
              <p className="text-xs text-[#7f5a5a]">
                Loyalty credit cannot be used for recurring memberships. It remains available for one-time purchases.
              </p>
            </div>
          ) : null}

          {showWalletControls ? (
            <div className="border-b border-[#d8cec6] px-4 py-4" data-testid="wallet-controls">
              <h2 className="text-sm font-semibold text-[#6f2b2b]">Gift card wallet</h2>
              <p className="mt-1 text-xs text-[#7f5a5a]">
                Available: {formatAmount(walletBalance.availableBalanceMinor, "EUR")}
              </p>
              {walletAmountMinor > 0 ? (
                <div className="mt-3 flex items-start justify-between gap-3">
                  <span className="text-sm text-[#5f4040]" data-testid="wallet-applied-amount">
                    Applied: {formatAmount(walletAmountMinor, "EUR")}
                  </span>
                  <button
                    type="button"
                    onClick={removeWallet}
                    className="text-xs text-[#7b2d2d] underline underline-offset-2"
                    data-testid="wallet-remove"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <label htmlFor="wallet-amount" className="block text-xs text-[#7f5a5a]">
                    Amount (EUR)
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input
                      id="wallet-amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={(maxApplicableWallet / 100).toFixed(2)}
                      value={walletInputValue}
                      onChange={(e) => setWalletInputValue(e.target.value)}
                      placeholder="0.00"
                      className="rounded border border-[#d8cec6] px-3 py-2 text-sm text-[#5f4040] outline-none"
                      data-testid="wallet-amount-input"
                    />
                    <button
                      type="button"
                      onClick={applyWallet}
                      className="rounded-md border border-[#7b2d2d] px-4 py-2 text-sm text-[#7b2d2d] hover:bg-[#f2ede7]"
                      data-testid="wallet-apply"
                    >
                      Apply
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setWalletInputValue((maxApplicableWallet / 100).toFixed(2));
                    }}
                    className="text-xs text-[#7b2d2d] underline underline-offset-2"
                    data-testid="wallet-use-all"
                  >
                    Use all available
                  </button>
                </div>
              )}
            </div>
          ) : null}

          {showRecurringWalletNote ? (
            <div className="border-b border-[#d8cec6] px-4 py-4" data-testid="wallet-recurring-note">
              <p className="text-xs text-[#7f5a5a]">
                Gift card wallet cannot be used for recurring memberships. Your wallet balance is still available for
                one-time purchases.
              </p>
            </div>
          ) : null}

          <div className="px-4 py-4">
            <button
              type="button"
              onClick={() => void startCheckout()}
              disabled={checkoutDisabled}
              aria-label="Checkout"
              className="w-full rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
            >
              {isSubmitting ? "Starting checkout..." : "Continue to payment"}
            </button>
          </div>
        </aside>
      </div>

      {showSignInModal ? (
        <SignInModal
          onClose={() => setShowSignInModal(false)}
          onSuccess={(targetHref) => window.location.assign(targetHref)}
          targetHref="/cart"
        />
      ) : null}
    </section>
  );
}
