"use client";

import { useState } from "react";

type AdminLoyaltyManualGrantModalProps = {
  currencyCode: string;
  defaultClientEmail?: string;
  defaultPoints?: number;
  page: number;
  query: string;
  submitAction: (formData: FormData) => Promise<void>;
};

export default function AdminLoyaltyManualGrantModal({
  currencyCode,
  defaultClientEmail = "",
  defaultPoints = 100,
  page,
  query,
  submitAction,
}: AdminLoyaltyManualGrantModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [grantRequestKey, setGrantRequestKey] = useState("");

  function buildGrantRequestKey() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `manual-grant-${Date.now()}`;
  }

  function openModal() {
    setGrantRequestKey(buildGrantRequestKey());
    setIsOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white"
      >
        Give points
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/35 px-4 py-8">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Manual grant"
            className="w-full max-w-3xl rounded-2xl border border-[#d3dbe5] bg-white shadow-[0_18px_60px_rgba(15,23,42,0.2)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#e2e8f0] px-6 py-5">
              <div>
                <h2 className="text-2xl font-semibold text-[#1f2735]">Manual grant</h2>
                <p className="mt-1 text-sm text-[#4b5a72]">
                  Positive grants only. Actor, reason, and audit metadata are recorded automatically.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-2xl leading-none text-[#1f2735] transition-opacity hover:opacity-70"
                aria-label="Close"
              >
                x
              </button>
            </div>

            <form action={submitAction} className="space-y-4 px-6 py-5">
              <input type="hidden" name="currencyCode" value={currencyCode} />
              <input type="hidden" name="query" value={query} />
              <input type="hidden" name="page" value={String(page)} />
              <input type="hidden" name="grantRequestKey" value={grantRequestKey} />

              <label className="space-y-1 text-sm text-[#334155]">
                <span className="font-medium">Client email</span>
                <input
                  name="clientEmail"
                  type="email"
                  defaultValue={defaultClientEmail}
                  placeholder="client@example.com"
                  className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                />
              </label>

              <label className="space-y-1 text-sm text-[#334155]">
                <span className="font-medium">Grant points</span>
                <input
                  name="amountPoints"
                  type="number"
                  min={1}
                  defaultValue={defaultPoints}
                  className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
                />
              </label>

              <label className="space-y-1 text-sm text-[#334155]">
                <span className="font-medium">Reason</span>
                <textarea
                  name="reason"
                  rows={5}
                  minLength={10}
                  placeholder="Explain why this audited grant is needed."
                  className="w-full rounded-md border border-[#cbd5e1] px-3 py-2"
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-full border border-[#cbd5e1] px-5 py-2 text-sm font-medium text-[#1f2735]"
                >
                  Cancel
                </button>
                <button type="submit" className="rounded-full bg-[#1d3652] px-5 py-2 text-sm font-semibold text-white">
                  Grant points
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
