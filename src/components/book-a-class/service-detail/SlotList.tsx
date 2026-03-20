"use client";

import Link from "next/link";

type SessionSlot = {
  availableSpots: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  isAvailable: boolean;
  startTime: string;
};

type SlotListProps = {
  selectedDate: string | null;
  serviceSlug: string;
  slots: SessionSlot[];
};

export function SlotList({
  serviceSlug,
  selectedDate,
  slots,
}: SlotListProps) {
  if (!selectedDate) {
    return (
      <div className="rounded-xl border border-[#d8cec6] bg-white p-4">
        <p className="text-sm text-[#7f5a5a]">Select a date to see available time slots.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#d8cec6] bg-white p-4">
      <h3 className="text-lg font-semibold text-[#6f2b2b]">Availability for {selectedDate}</h3>

      {slots.length === 0 ? (
        <p className="mt-3 text-sm text-[#7f5a5a]">No availability on this date.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {slots.map((slot) => {
            return (
              <li key={slot.id} className="rounded-lg border border-[#d8cec6] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#6f2b2b]">
                      {slot.startTime} - {slot.endTime}
                    </p>
                    <p className="text-xs text-[#7f5a5a]">
                      {slot.isAvailable
                        ? `${slot.availableSpots} of ${slot.capacity} spots left`
                        : "Session is full"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/book-a-class/${serviceSlug}/book?sessionId=${slot.id}`}
                      aria-disabled={!slot.isAvailable}
                      className={`rounded-md px-3 py-1 text-sm ${
                        slot.isAvailable
                          ? "bg-[#7b2d2d] text-[#f4eee8] hover:opacity-90"
                          : "pointer-events-none cursor-not-allowed bg-[#eee8e1] text-[#a68f83]"
                      }`}
                      aria-label={`Book slot ${slot.startTime} to ${slot.endTime}`}
                    >
                      {slot.isAvailable ? "Book" : "Full"}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
