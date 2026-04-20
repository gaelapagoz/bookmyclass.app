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
  readClientCart,
  removeClientCartLine,
  subscribeToClientCart,
  updateClientCartLineQuantity,
  validateClientCart,
} from "@/lib/cart/cart-client";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

type CheckoutApiPayload = {
  code?: string;
  message?: string;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  retryAfterMs?: number;
  idempotency?: {
    state?: string;
  };
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

export function CartPageClient() {
  const [lines, setLines] = useState<ClientCartLine[]>([]);
  const [clientCartVersion, setClientCartVersion] = useState<number>(1);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [showVerifyEmailAction, setShowVerifyEmailAction] = useState(false);
  const [submissionState, setSubmissionState] = useState<{ key: string; fingerprint: string } | null>(null);

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

  const subtotalMinor = useMemo(() => getClientCartSubtotalMinor(lines), [lines]);
  const subtotalCurrency = lines[0]?.currencyCode ?? "EUR";
  const validation = useMemo(() => validateClientCart({ lines }), [lines]);
  const fingerprint = useMemo(() => getCheckoutSubmissionFingerprint(lines), [lines]);

  const checkoutDisabled = !validation.ok || lines.length === 0 || isSubmitting;

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
      submissionState && submissionState.fingerprint === fingerprint
        ? submissionState.key
        : generateCartCheckoutIdempotencyKey();
    debugLog("checkout_click", {
      keySource: submissionState && submissionState.fingerprint === fingerprint ? "reused" : "generated",
      idempotencyKey: key,
      fingerprint,
      lineCount: lines.length,
      clientCartVersion,
    });

    setSubmissionState({ key, fingerprint });
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
      });

      for (let attempt = 0; attempt < MAX_IN_PROGRESS_ATTEMPTS; attempt += 1) {
        debugLog("request_attempt", {
          idempotencyKey: key,
          attempt: attempt + 1,
          maxAttempts: MAX_IN_PROGRESS_ATTEMPTS,
          fingerprint,
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
          code: payload.code ?? null,
          idempotencyState: payload.idempotency?.state ?? null,
          retryAfterMs: payload.retryAfterMs ?? null,
        });

        if (response.status === 200 && payload.checkoutUrl) {
          if (typeof payload.checkoutSessionId === "string" && payload.checkoutSessionId.trim()) {
            rememberClientCartSnapshotForCheckoutSession({
              checkoutSessionId: payload.checkoutSessionId,
              fingerprint,
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
      <section className="mx-auto w-full max-w-5xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Your Cart</h1>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">Your Cart</h1>
        <Link href="/subscription" className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80">
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

      {lines.length === 0 ? (
        <div className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-5 text-sm text-[#5f4040]">
          Your cart is empty.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {lines.map((line) => {
            const isRecurring = line.priceType === PriceType.RECURRING;
            return (
              <article
                key={`${line.productId}:${line.priceId}`}
                className="rounded-xl border border-[#d8cec6] bg-white p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-[#6f2b2b]">{line.productName}</h2>
                    <p className="text-sm text-[#5f4040]">{line.priceName}</p>
                    <p className="mt-1 text-xs text-[#7f5a5a]">
                      {isRecurring ? "Recurring product" : "One-time product"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(line)}
                    className="text-sm text-[#7b2d2d] underline underline-offset-4"
                  >
                    Remove
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
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
                  <p className="text-sm font-medium text-[#6f2b2b]">
                    {formatAmount(line.unitAmountMinor * line.quantity, line.currencyCode)}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="mt-6 rounded-xl border border-[#d8cec6] bg-white p-4">
        <div className="flex items-center justify-between text-sm text-[#5f4040]">
          <span>Subtotal</span>
          <span className="font-medium text-[#6f2b2b]">{formatAmount(subtotalMinor, subtotalCurrency)}</span>
        </div>
        <button
          type="button"
          onClick={() => void startCheckout()}
          disabled={checkoutDisabled}
          className="mt-4 w-full rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
        >
          {isSubmitting ? "Starting checkout..." : "Checkout"}
        </button>
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
