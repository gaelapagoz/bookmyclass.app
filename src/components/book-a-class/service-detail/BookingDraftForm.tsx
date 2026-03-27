"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type BookingSessionSummary = {
  availableSpots: number;
  capacity: number;
  classTitle: string;
  dateTime: string;
  place: string;
  serviceId: string;
  serviceSlug: string;
  sessionId: string;
  teacher: string;
};

type BookingDraftFormProps = {
  initialValues: {
    customerEmail: string;
    customerName: string;
    customerPhone: string;
  };
  isAuthenticated: boolean;
  session: BookingSessionSummary;
};

type PaymentMode = "SINGLE_SESSION" | "NEW_PLAN_PURCHASE" | "EXISTING_PLAN";

type PaymentOptionsResponse = {
  paymentOptions: {
    existingPlans: Array<{
      bookingLabel: string;
      displayName: string;
      entitlementType: "CREDIT_PACK" | "SINGLE_USE" | "UNLIMITED_ACCESS";
      entitlementId: string;
      planSource: "CREDITS" | "SUBSCRIPTION";
      productName: string;
      remainingCredits: number | null;
    }>;
    newPlanOptions: Array<{
      amountMinor: number;
      bookingLabel: string;
      currencyCode: string;
      displayName: string;
      priceId: string;
      priceName: string;
      productName: string;
    }>;
    singleSession: {
      amountMinor: number;
      bookingLabel: string;
      currencyCode: string;
      displayName: string;
      priceId: string;
      priceName: string;
    } | null;
    ux: {
      recommended: {
        entitlementId: string | null;
        mode: PaymentMode | null;
        priceId: string | null;
      };
    };
  };
};

type DraftResponse = {
  draft: {
    bookingId: string;
    status: "PENDING";
  };
};

type ErrorResponse = {
  details?: string;
  error?: string;
  issues?: Array<{ message: string; path?: string }>;
};

type SelectedPaymentOption =
  | {
      amountMinor: number;
      currencyCode: string;
      id: string;
      label: string;
      mode: "NEW_PLAN_PURCHASE" | "SINGLE_SESSION";
    }
  | {
      amountMinor: 0;
      currencyCode: "EUR";
      id: string;
      label: string;
      mode: "EXISTING_PLAN";
    };

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function parseError(payload: ErrorResponse | null, status: number): string {
  if (payload?.issues?.length) {
    return payload.issues[0]?.message ?? "Invalid booking details.";
  }

  if (payload?.error) {
    return payload.error;
  }

  return `Request failed (HTTP ${status}).`;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const responseWithFallback = response as Response & { text?: () => Promise<string> };
  if (typeof responseWithFallback.text !== "function") {
    return response.json();
  }

  const rawBody = await responseWithFallback.text();
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

export function BookingDraftForm({ session, initialValues, isAuthenticated }: BookingDraftFormProps) {
  const router = useRouter();
  const [customerName, setCustomerName] = useState(initialValues.customerName);
  const [customerEmail, setCustomerEmail] = useState(initialValues.customerEmail);
  const [customerPhone, setCustomerPhone] = useState(initialValues.customerPhone);
  const [customerMessage, setCustomerMessage] = useState("");
  const [consentTermsAccepted, setConsentTermsAccepted] = useState(false);
  const [consentPrivacyAccepted, setConsentPrivacyAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptionsResponse["paymentOptions"] | null>(null);
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>("");
  const [isLoadingPaymentOptions, setIsLoadingPaymentOptions] = useState(true);

  const selectableOptions = useMemo(() => {
    if (!paymentOptions) {
      return [] as Array<{ key: string; option: SelectedPaymentOption }>;
    }

    const options: Array<{ key: string; option: SelectedPaymentOption }> = [];
    if (paymentOptions.singleSession) {
      options.push({
        key: `single:${paymentOptions.singleSession.priceId}`,
        option: {
          mode: "SINGLE_SESSION",
          id: paymentOptions.singleSession.priceId,
          label: paymentOptions.singleSession.bookingLabel,
          amountMinor: paymentOptions.singleSession.amountMinor,
          currencyCode: paymentOptions.singleSession.currencyCode,
        },
      });
    }

    for (const plan of paymentOptions.existingPlans) {
      options.push({
        key: `existing:${plan.entitlementId}`,
        option: {
          mode: "EXISTING_PLAN",
          id: plan.entitlementId,
          label: plan.bookingLabel,
          amountMinor: 0,
          currencyCode: "EUR",
        },
      });
    }

    for (const plan of paymentOptions.newPlanOptions) {
      options.push({
        key: `plan:${plan.priceId}`,
        option: {
          mode: "NEW_PLAN_PURCHASE",
          id: plan.priceId,
          label: plan.bookingLabel,
          amountMinor: plan.amountMinor,
          currencyCode: plan.currencyCode,
        },
      });
    }

    return options;
  }, [paymentOptions]);

  const selectedPaymentOption = useMemo(() => {
    return selectableOptions.find((entry) => entry.key === selectedOptionKey)?.option ?? null;
  }, [selectedOptionKey, selectableOptions]);

  useEffect(() => {
    let active = true;

    const loadPaymentOptions = async () => {
      setIsLoadingPaymentOptions(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({
          serviceSlug: session.serviceSlug,
        });
        const response = await fetch(`/api/bookings/payment-options-preview?${params.toString()}`);
        const payload = (await parseJsonResponse(response)) as PaymentOptionsResponse | ErrorResponse | null;

        if (!response.ok || !payload || !("paymentOptions" in payload)) {
          if (!active) {
            return;
          }
          setPaymentOptions(null);
          setSelectedOptionKey("");
          setErrorMessage(parseError(payload as ErrorResponse | null, response.status));
          return;
        }

        if (!active) {
          return;
        }

        setPaymentOptions(payload.paymentOptions);

        const recommended = payload.paymentOptions.ux.recommended;
        if (recommended.mode === "EXISTING_PLAN" && recommended.entitlementId) {
          setSelectedOptionKey(`existing:${recommended.entitlementId}`);
        } else if (recommended.mode === "SINGLE_SESSION" && recommended.priceId) {
          setSelectedOptionKey(`single:${recommended.priceId}`);
        } else if (recommended.mode === "NEW_PLAN_PURCHASE" && recommended.priceId) {
          setSelectedOptionKey(`plan:${recommended.priceId}`);
        } else {
          const fallbackExisting = payload.paymentOptions.existingPlans[0];
          const fallbackSingle = payload.paymentOptions.singleSession;
          const fallbackPlan = payload.paymentOptions.newPlanOptions[0];

          if (fallbackExisting) {
            setSelectedOptionKey(`existing:${fallbackExisting.entitlementId}`);
          } else if (fallbackSingle) {
            setSelectedOptionKey(`single:${fallbackSingle.priceId}`);
          } else if (fallbackPlan) {
            setSelectedOptionKey(`plan:${fallbackPlan.priceId}`);
          } else {
            setSelectedOptionKey("");
          }
        }
      } catch {
        if (active) {
          setPaymentOptions(null);
          setSelectedOptionKey("");
          setErrorMessage("Could not load payment options.");
        }
      } finally {
        if (active) {
          setIsLoadingPaymentOptions(false);
        }
      }
    };

    void loadPaymentOptions();
    return () => {
      active = false;
    };
  }, [session.serviceSlug, session.sessionId]);

  const primaryCtaLabel = useMemo(() => {
    if (isSubmitting) {
      return "Processing...";
    }

    if (!selectedPaymentOption) {
      return "Continue";
    }

    if (selectedPaymentOption.mode === "EXISTING_PLAN") {
      return "Confirm Using Plan";
    }

      return `Continue To Secure Checkout (${formatMoney(selectedPaymentOption.amountMinor, selectedPaymentOption.currencyCode)})`;
  }, [isSubmitting, selectedPaymentOption]);

  const selectedExistingPlan = useMemo(() => {
    if (!selectedPaymentOption || selectedPaymentOption.mode !== "EXISTING_PLAN") {
      return null;
    }

    return (
      paymentOptions?.existingPlans.find((plan) => plan.entitlementId === selectedPaymentOption.id) ?? null
    );
  }, [paymentOptions?.existingPlans, selectedPaymentOption]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    if (!selectedPaymentOption) {
      setErrorMessage("Select a payment option to continue.");
      setIsSubmitting(false);
      return;
    }

    try {
      const createDraftResponse = await fetch("/api/bookings/draft", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          serviceSlug: session.serviceSlug,
          sessionId: session.sessionId,
          customerName,
          customerEmail,
          customerPhone,
          customerMessage,
          bookingIntent:
            selectedPaymentOption.mode === "EXISTING_PLAN"
              ? "USE_PLAN"
              : "SINGLE_BOOKING",
          consentTermsAccepted,
          consentPrivacyAccepted,
        }),
      });

      const draftPayload = (await parseJsonResponse(createDraftResponse)) as DraftResponse | ErrorResponse | null;
      if (!createDraftResponse.ok || !draftPayload || !("draft" in draftPayload)) {
        setErrorMessage(parseError(draftPayload as ErrorResponse | null, createDraftResponse.status));
        return;
      }

      const bookingId = draftPayload.draft.bookingId;
      const applyPayload =
        selectedPaymentOption.mode === "EXISTING_PLAN"
          ? {
              mode: "EXISTING_PLAN",
              entitlementId: selectedPaymentOption.id,
            }
          : {
              mode: selectedPaymentOption.mode,
              priceId: selectedPaymentOption.id,
            };

      const applyResponse = await fetch(`/api/bookings/${bookingId}/apply-plan`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(applyPayload),
      });

      const applyResponsePayload = (await parseJsonResponse(applyResponse)) as ErrorResponse | null;
      if (!applyResponse.ok) {
        setErrorMessage(parseError(applyResponsePayload, applyResponse.status));
        return;
      }

      if (selectedPaymentOption.mode === "EXISTING_PLAN") {
        router.push(`/book-a-class/${session.serviceSlug}/confirmed?bookingId=${bookingId}`);
        return;
      }

      const checkoutResponse = await fetch("/api/checkout/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ bookingId }),
      });

      const checkoutPayload = (await parseJsonResponse(checkoutResponse)) as
        | { checkout?: { checkoutUrl?: string } }
        | ErrorResponse
        | null;
      if (
        !checkoutResponse.ok ||
        !checkoutPayload ||
        !("checkout" in checkoutPayload) ||
        !checkoutPayload.checkout?.checkoutUrl
      ) {
        setErrorMessage(parseError(checkoutPayload as ErrorResponse | null, checkoutResponse.status));
        return;
      }

      window.location.assign(checkoutPayload.checkout.checkoutUrl);
    } catch {
      setErrorMessage("Could not continue booking.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-12 lg:grid-cols-[1.3fr_1fr]">
      <form onSubmit={handleSubmit} className="rounded-xl border border-[#d8cec6] bg-white p-5">
        <h1 className="text-2xl font-semibold text-[#6f2b2b]">Booking Details</h1>
        <p className="mt-1 text-sm text-[#7f5a5a]">
          {isAuthenticated
            ? `Signed in as ${initialValues.customerName || initialValues.customerEmail || "your account"}.`
            : "Guest booking - complete your details to continue."}
        </p>
        {isAuthenticated ? (
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/" })}
            className="mt-2 text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          >
            Not you? Log out
          </button>
        ) : null}

        <div className="mt-5 grid gap-4">
          <label className="text-sm text-[#5f4040]">
            Name
            <input
              required
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          <label className="text-sm text-[#5f4040]">
            Email
            <input
              type="email"
              required
              value={customerEmail}
              readOnly={isAuthenticated}
              onChange={(event) => {
                if (!isAuthenticated) {
                  setCustomerEmail(event.target.value);
                }
              }}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          <label className="text-sm text-[#5f4040]">
            Phone
            <input
              required
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
          </label>

          <label className="text-sm text-[#5f4040]">
            Message for the studio (optional)
            <textarea
              value={customerMessage}
              onChange={(event) => setCustomerMessage(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-[#d8cec6] px-3 py-2"
            />
            <p className="mt-1 text-xs text-[#7f5a5a]">
              This message is saved with your booking and visible to the admin.
            </p>
          </label>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium text-[#6f2b2b]">Payment Option</legend>
          {isLoadingPaymentOptions ? (
            <p className="mt-2 text-sm text-[#7f5a5a]">Loading payment options...</p>
          ) : (
            <>
              <label className="mt-2 block text-sm text-[#5f4040]">
                Select how you want to continue
                <select
                  value={selectedOptionKey}
                  onChange={(event) => setSelectedOptionKey(event.target.value)}
                  className="mt-1 w-full rounded-md border border-[#d8cec6] bg-white px-3 py-2"
                  required
                >
                  <option value="" disabled>
                    Choose a payment option
                  </option>
                  {selectableOptions.map((entry) => (
                    <option key={entry.key} value={entry.key}>
                      {entry.option.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectableOptions.length === 0 ? (
                <p className="mt-2 text-sm text-[#7b2d2d]">No payment options are currently available for this booking.</p>
              ) : null}
              <p className="mt-2 text-xs text-[#7f5a5a]">
                Secure card details are entered on Stripe on the next step when payment is required.
              </p>
            </>
          )}
        </fieldset>

        <fieldset className="mt-6 space-y-2 text-sm text-[#5f4040]">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consentTermsAccepted}
              onChange={(event) => setConsentTermsAccepted(event.target.checked)}
              required
            />
            <span>
              I accept the{" "}
              <Link
              href="/about/terms-and-conditions"
              className="underline underline-offset-4 hover:opacity-80"
              >
              Terms and Conditions
              </Link>
              .
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consentPrivacyAccepted}
              onChange={(event) => setConsentPrivacyAccepted(event.target.checked)}
              required
            />
            <span>No cancellation or rescheduling is permitted within 24 hour(s) of the appointment time</span>
          </label>
        </fieldset>

        {errorMessage ? <p className="mt-4 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting || isLoadingPaymentOptions || !selectedPaymentOption}
          className="mt-6 rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] disabled:opacity-60"
        >
          {primaryCtaLabel}
        </button>
      </form>

      <aside className="rounded-xl border border-[#d8cec6] bg-[#f4eee8] p-5">
        <h2 className="text-lg font-semibold text-[#6f2b2b]">Booking Summary</h2>
        <dl className="mt-4 space-y-2 text-sm text-[#5f4040]">
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Class</dt>
            <dd>{session.classTitle}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Date & Time</dt>
            <dd>{session.dateTime}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Teacher</dt>
            <dd>{session.teacher}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Place</dt>
            <dd>{session.place}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium">Spots left</dt>
            <dd>
              {session.availableSpots} / {session.capacity}
            </dd>
          </div>
        </dl>

        <div className="mt-4 rounded-md border border-[#d8cec6] bg-white p-3 text-sm text-[#5f4040]">
          <p className="font-medium text-[#6f2b2b]">Payment Details</p>
          {selectedPaymentOption ? (
            <>
              <p className="mt-2">{selectedPaymentOption.label}</p>
              {selectedPaymentOption.mode === "EXISTING_PLAN" ? (
                <>
                  {selectedExistingPlan?.planSource === "SUBSCRIPTION" ? (
                    <>
                      <p className="mt-1">Covered by your membership.</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-1">Using 1 credit.</p>
                      <p className="mt-1">
                        Credits remaining: {selectedExistingPlan?.remainingCredits ?? "N/A"}
                      </p>
                      <p className="mt-1">No payment due now.</p>
                    </>
                  )}
                </>
              ) : (
                <p className="mt-1">
                  Total: {formatMoney(selectedPaymentOption.amountMinor, selectedPaymentOption.currencyCode)}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2">Select a payment option to see total details.</p>
          )}
        </div>
      </aside>
    </section>
  );
}
