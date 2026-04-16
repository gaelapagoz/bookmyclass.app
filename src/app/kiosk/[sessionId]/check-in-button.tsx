"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkInBookingFromKiosk } from "./actions";

interface CheckInButtonProps {
  bookingId: string;
  sessionId: string;
}

export function CheckInButton({ bookingId, sessionId }: CheckInButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const router = useRouter();

  const handleCheckIn = () => {
    startTransition(async () => {
      try {
        setErrorMessage(null);
        setSuccessMessage(null);
        await checkInBookingFromKiosk({ bookingId, sessionId });
        setSuccessMessage("Checked in.");
        router.refresh();
      } catch (error) {
        console.error("Check-in failed:", error);
        setSuccessMessage(null);
        setErrorMessage("Check-in failed. This booking may be outside the check-in window.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleCheckIn}
        disabled={isPending}
        data-testid={`kiosk-check-in-${bookingId}`}
        className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#f4eee8] transition-colors hover:bg-[#5a1f1f] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Checking In..." : "Check In"}
      </button>
      <p aria-live="polite" className="min-h-[1.25rem] text-xs text-[#4b5a72]">
        {successMessage ?? errorMessage ?? ""}
      </p>
    </div>
  );
}
