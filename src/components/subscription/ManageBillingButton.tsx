"use client";

import { useState } from "react";
import { runAsyncWithCursor } from "@/lib/ui/async-loading";

export function ManageBillingButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManageBilling = async () => {
    setIsLoading(true);
    setError(null);

    await runAsyncWithCursor(async () => {
      try {
        const response = await fetch("/api/subscription/portal", { method: "POST" });
        const payload = (await response.json()) as { portalUrl?: string; error?: string };

        if (response.status === 401) {
          window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent("/dashboard/membership")}`);
          return;
        }

        if (!response.ok || !payload.portalUrl) {
          setError(payload.error ?? "Could not open billing portal.");
          return;
        }

        window.location.assign(payload.portalUrl);
      } catch {
        setError("Could not open billing portal.");
      }
    });

    setIsLoading(false);
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void handleManageBilling()}
        disabled={isLoading}
        className="inline-flex items-center rounded-md border border-[#7b2d2d] px-3 py-2 text-sm font-medium text-[#7b2d2d] disabled:opacity-60"
      >
        {isLoading ? (
          <>
            <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            Opening billing...
          </>
        ) : (
          "Manage billing"
        )}
      </button>
      {error ? <p className="mt-2 text-sm text-[#7b2d2d]">{error}</p> : null}
    </div>
  );
}

