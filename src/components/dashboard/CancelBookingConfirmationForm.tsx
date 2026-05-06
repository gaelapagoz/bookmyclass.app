"use client";

import { useRef, useState } from "react";

type Props = {
  bookingId: string;
  action: (formData: FormData) => void | Promise<void>;
  disabled: boolean;
  describedBy?: string;
};

export default function CancelBookingConfirmationForm({ bookingId, action, disabled, describedBy }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  function openDialog() {
    setOpen(true);
    dialogRef.current?.showModal?.();
  }

  function closeDialog() {
    dialogRef.current?.close?.();
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        data-testid={`dashboard-cancel-${bookingId}`}
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={openDialog}
        className="rounded-md border border-[#7b2d2d] px-3 py-1 text-sm text-[#7b2d2d] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Cancel booking
      </button>
      <dialog
        ref={dialogRef}
        open={open}
        aria-labelledby={`cancel-booking-title-${bookingId}`}
        className="rounded-md border border-[#d8cec6] bg-white p-4 text-[#5f4040] shadow-lg backdrop:bg-black/30"
      >
        <form action={action} className="space-y-3">
          <input type="hidden" name="bookingId" value={bookingId} />
          <h3 id={`cancel-booking-title-${bookingId}`} className="text-base font-semibold text-[#6f2b2b]">
            Cancel booking?
          </h3>
          <p className="text-sm">Please confirm before cancelling this booking.</p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={closeDialog}
              className="rounded-md border border-[#d8cec6] px-3 py-1 text-sm text-[#5f4040]"
            >
              Keep booking
            </button>
            <button type="submit" className="rounded-md bg-[#7b2d2d] px-3 py-1 text-sm text-white">
              Confirm cancellation
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
