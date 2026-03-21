"use client";

import { useState } from "react";

export function ManageBillingButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManageBilling = async () => {
    setIsLoading(true);
    setError(null);

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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => void handleManageBilling()}
        disabled={isLoading}
        className="rounded-md border border-[#7b2d2d] px-3 py-2 text-sm font-medium text-[#7b2d2d] disabled:opacity-60"
      >
        {isLoading ? "Opening billing..." : "Manage billing"}
      </button>
      {error ? <p className="mt-2 text-sm text-[#7b2d2d]">{error}</p> : null}
    </div>
  );
}

