"use client";

import { useMemo, useState } from "react";

type GeneratedGiftCard = {
  id: string;
  maskedCode: string;
  amountMinor: number;
  currencyCode: string;
  recipientEmail: string;
  recipientName: string | null;
  emailStatus: string;
};

type FormState = {
  amountMajor: string;
  recipientEmail: string;
  recipientName: string;
  adminMessage: string;
  adminReason: string;
  expiresAt: string;
};

function formatMoney(amountMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: currencyCode,
  }).format(amountMinor / 100);
}

function initialState(): FormState {
  return {
    amountMajor: "",
    recipientEmail: "",
    recipientName: "",
    adminMessage: "",
    adminReason: "",
    expiresAt: "",
  };
}

export default function AdminGiftCardGenerationPanel() {
  const [step, setStep] = useState<"form" | "review" | "done">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(initialState);
  const [created, setCreated] = useState<GeneratedGiftCard | null>(null);
  const [reviewIdempotencyKey, setReviewIdempotencyKey] = useState<string | null>(null);

  const normalized = useMemo(
    () => ({
      amountMajor: form.amountMajor.trim(),
      amountMinor: Math.round(Number(form.amountMajor) * 100),
      recipientEmail: form.recipientEmail.trim(),
      recipientName: form.recipientName.trim(),
      adminMessage: form.adminMessage.trim(),
      adminReason: form.adminReason.trim(),
      expiresAt: form.expiresAt.trim(),
    }),
    [form],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateBeforeReview(): string | null {
    if (!normalized.amountMajor || Number.isNaN(Number(normalized.amountMajor)) || normalized.amountMinor <= 0) {
      return "Enter a valid amount in euros.";
    }
    if (!normalized.recipientEmail) {
      return "Recipient email is required.";
    }
    if (!normalized.adminReason) {
      return "Internal reason is required.";
    }
    return null;
  }

  async function submitGenerate() {
    setSubmitting(true);
    setError(null);

    try {
      const idempotencyKey = reviewIdempotencyKey;
      if (!idempotencyKey) {
        setError("Review step expired. Please review and submit again.");
        return;
      }
      const response = await fetch("/api/admin/gift-cards/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotencyKey,
          amountMinor: normalized.amountMinor,
          recipientEmail: normalized.recipientEmail,
          recipientName: normalized.recipientName || null,
          adminMessage: normalized.adminMessage || null,
          adminReason: normalized.adminReason,
          expiresAt: normalized.expiresAt ? new Date(normalized.expiresAt).toISOString() : null,
          currencyCode: "EUR",
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.code ? `Request failed: ${body.code}` : "Request failed.");
        return;
      }

      const body = (await response.json()) as GeneratedGiftCard;
      setCreated(body);
      setStep("done");
    } catch {
      setError("Unable to generate and send gift card right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4 rounded-md border border-[#d3dbe5] bg-white p-5">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[#1f2735]">Generate Gift Card</h2>
        <p className="text-sm text-[#4b5a72]">No wallet balance is credited until redemption.</p>
      </header>

      {step === "form" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm text-[#1f2735]">
              Amount (EUR)
              <input type="number" step="0.01" min="0.01" value={form.amountMajor} onChange={(event) => update("amountMajor", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
            </label>
            <label className="text-sm text-[#1f2735]">
              Recipient email
              <input type="email" value={form.recipientEmail} onChange={(event) => update("recipientEmail", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
            </label>
            <label className="text-sm text-[#1f2735]">
              Recipient name (optional)
              <input value={form.recipientName} onChange={(event) => update("recipientName", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
            </label>
            <label className="text-sm text-[#1f2735]">
              Expiry (optional)
              <input type="datetime-local" value={form.expiresAt} onChange={(event) => update("expiresAt", event.target.value)} className="mt-1 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
            </label>
          </div>
          <label className="block text-sm text-[#1f2735]">
            Message (optional)
            <textarea value={form.adminMessage} onChange={(event) => update("adminMessage", event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#1f2735]">
            Internal reason (required)
            <textarea value={form.adminReason} onChange={(event) => update("adminReason", event.target.value)} className="mt-1 min-h-20 w-full rounded-md border border-[#cbd5e1] px-3 py-2" />
          </label>
          {error ? <p className="text-sm text-[#8b1c1c]">{error}</p> : null}
          <div>
            <button type="button" onClick={() => {
              const validationError = validateBeforeReview();
              if (validationError) {
                setError(validationError);
                return;
              }
              setReviewIdempotencyKey(`admin-gc-${Date.now()}-${globalThis.crypto.randomUUID()}`);
              setError(null);
              setStep("review");
            }} className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white">
              Review
            </button>
          </div>
        </>
      ) : null}

      {step === "review" ? (
        <>
          <h3 className="text-base font-semibold text-[#1f2735]">Review</h3>
          <dl className="grid gap-2 text-sm text-[#1f2735] md:grid-cols-2">
            <div><dt className="font-semibold">Amount</dt><dd>{formatMoney(normalized.amountMinor, "EUR")}</dd></div>
            <div><dt className="font-semibold">Recipient email</dt><dd>{normalized.recipientEmail}</dd></div>
            <div><dt className="font-semibold">Recipient name</dt><dd>{normalized.recipientName || "-"}</dd></div>
            <div><dt className="font-semibold">Expiry</dt><dd>{normalized.expiresAt || "-"}</dd></div>
            <div><dt className="font-semibold">Message</dt><dd>{normalized.adminMessage || "-"}</dd></div>
            <div><dt className="font-semibold">Internal reason</dt><dd>{normalized.adminReason}</dd></div>
          </dl>
          <p className="rounded-md border border-[#f1d6a8] bg-[#fff7eb] p-3 text-sm text-[#7a4b00]">Warning: no wallet balance is credited until redemption.</p>
          {error ? <p className="text-sm text-[#8b1c1c]">{error}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => {
              setReviewIdempotencyKey(null);
              setStep("form");
            }} className="rounded-md border border-[#cbd5e1] px-4 py-2 text-sm">Back</button>
            <button type="button" disabled={submitting} onClick={submitGenerate} className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Generate and Send</button>
          </div>
        </>
      ) : null}

      {step === "done" && created ? (
        <div className="space-y-2 rounded-md border border-[#d3dbe5] bg-[#f8fbff] p-4 text-sm text-[#1f2735]">
          <h3 className="text-base font-semibold">Gift card generated</h3>
          <p>Email sent status: {created.emailStatus}</p>
          <p>Masked code: <span className="font-mono">{created.maskedCode}</span></p>
          <p>No plaintext code is available after submit.</p>
          <a href="/admin/gift-cards" className="inline-block rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white">Back to Gift Cards</a>
        </div>
      ) : null}
    </section>
  );
}
