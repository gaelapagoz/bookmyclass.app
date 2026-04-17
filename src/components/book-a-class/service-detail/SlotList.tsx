"use client";

import Link from "next/link";
import { getFullSlotMessage, getSlotUiState } from "./slot-ui-state";

type SessionSlot = {
  availableSpots: number;
  capacity: number;
  date: string;
  endTime: string;
  id: string;
  isAvailable: boolean;
  isWaitlistAvailable: boolean;
  isWaitlistSupported: boolean;
  startTime: string;
  waitlistSpotsLeft: number;
};

type SlotListProps = {
  isAuthenticated: boolean;
  joinedWaitlistSlotIds: string[];
  joiningSlotId: string | null;
  onJoinWaitlist: (slotId: string) => void;
  onRequireSignIn: (targetHref: string) => void;
  selectedDate: string | null;
  serviceSlug: string;
  slots: SessionSlot[];
};

export function SlotList({
  isAuthenticated,
  joinedWaitlistSlotIds,
  joiningSlotId,
  onJoinWaitlist,
  onRequireSignIn,
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
            const bookingHref = `/book-a-class/${serviceSlug}/book?sessionId=${slot.id}`;
            const uiState = getSlotUiState({
              isAvailable: slot.isAvailable,
              isWaitlistAvailable: slot.isWaitlistAvailable,
              isWaitlistSupported: slot.isWaitlistSupported,
            });
            const isJoiningWaitlist = joiningSlotId === slot.id;
            const isAlreadyJoinedWaitlist = joinedWaitlistSlotIds.includes(slot.id);
            const fullSlotMessage = getFullSlotMessage({
              isWaitlistSupported: slot.isWaitlistSupported,
            });

            return (
              <li
                key={slot.id}
                data-testid={`service-slot-${slot.id}`}
                className="rounded-lg border border-[#d8cec6] bg-white p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#6f2b2b]">
                      {slot.startTime} - {slot.endTime}
                    </p>
                    <p className="text-xs text-[#7f5a5a]">
                      {uiState === "BOOKABLE"
                        ? `${slot.availableSpots} of ${slot.capacity} spots left`
                        : fullSlotMessage}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {uiState === "BOOKABLE" ? (
                      isAuthenticated ? (
                        <Link
                          href={bookingHref}
                          className="rounded-md bg-[#7b2d2d] px-3 py-1 text-sm text-[#f4eee8] hover:opacity-90"
                          aria-label={`Book slot ${slot.startTime} to ${slot.endTime}`}
                        >
                          Book
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRequireSignIn(bookingHref)}
                          className="rounded-md bg-[#7b2d2d] px-3 py-1 text-sm text-[#f4eee8] hover:opacity-90"
                          aria-label={`Sign in to book slot ${slot.startTime} to ${slot.endTime}`}
                        >
                          Book
                        </button>
                      )
                    ) : uiState === "WAITLIST_JOINABLE" ? (
                      isAuthenticated ? (
                        <button
                          type="button"
                          disabled={isJoiningWaitlist || isAlreadyJoinedWaitlist}
                          onClick={() => onJoinWaitlist(slot.id)}
                          className="rounded-md border border-[#7b2d2d] px-3 py-1 text-sm text-[#7b2d2d] hover:bg-[#f2ede7] disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Join waitlist for slot ${slot.startTime} to ${slot.endTime}`}
                        >
                          {isAlreadyJoinedWaitlist ? "On Waitlist" : isJoiningWaitlist ? "Joining..." : "Join Waitlist"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRequireSignIn(`/book-a-class/${serviceSlug}`)}
                          className="rounded-md border border-[#7b2d2d] px-3 py-1 text-sm text-[#7b2d2d] hover:bg-[#f2ede7]"
                          aria-label={`Sign in to join waitlist for slot ${slot.startTime} to ${slot.endTime}`}
                        >
                          Join Waitlist
                        </button>
                      )
                    ) : (
                      <span
                        className="pointer-events-none cursor-not-allowed rounded-md bg-[#eee8e1] px-3 py-1 text-sm text-[#a68f83]"
                        aria-label={`Slot ${slot.startTime} to ${slot.endTime} is full and waitlist unavailable`}
                      >
                        {slot.isWaitlistSupported ? "Waitlist Full" : "Full"}
                      </span>
                    )}
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
