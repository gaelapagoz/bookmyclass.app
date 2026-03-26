import { BookingStatus, StudioSessionStatus } from "@prisma/client";

const DEFAULT_BOOKING_CANCELLATION_WINDOW_HOURS = 24;

export type BookingCancellationBlockCode =
  | "ALREADY_CANCELLED"
  | "SESSION_NOT_ACTIVE"
  | "SESSION_STARTED"
  | "WINDOW_PASSED";

export type BookingCancellationEvaluation = {
  canCancel: boolean;
  cancellationEligibleUntilAt: Date;
  blockCode: BookingCancellationBlockCode | null;
  cancellationBlockedReason: string | null;
};

export function normalizeBookingCancellationWindowHours(
  value: number | null | undefined,
): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_BOOKING_CANCELLATION_WINDOW_HOURS;
  }

  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : DEFAULT_BOOKING_CANCELLATION_WINDOW_HOURS;
}

export function computeCancellationEligibleUntilAt(
  startsAt: Date,
  cancellationWindowHours: number,
): Date {
  return new Date(startsAt.getTime() - cancellationWindowHours * 60 * 60 * 1000);
}

export function evaluateBookingCancellation(input: {
  bookingStatus: BookingStatus;
  sessionStatus: StudioSessionStatus;
  sessionStartsAt: Date;
  now: Date;
  cancellationWindowHours: number;
}): BookingCancellationEvaluation {
  const cancellationEligibleUntilAt = computeCancellationEligibleUntilAt(
    input.sessionStartsAt,
    input.cancellationWindowHours,
  );

  if (input.bookingStatus === BookingStatus.CANCELLED) {
    return {
      canCancel: false,
      cancellationEligibleUntilAt,
      blockCode: "ALREADY_CANCELLED",
      cancellationBlockedReason: "Booking is already cancelled.",
    };
  }

  if (input.sessionStatus !== StudioSessionStatus.SCHEDULED) {
    return {
      canCancel: false,
      cancellationEligibleUntilAt,
      blockCode: "SESSION_NOT_ACTIVE",
      cancellationBlockedReason: "Session is no longer available for cancellation.",
    };
  }

  if (input.sessionStartsAt <= input.now) {
    return {
      canCancel: false,
      cancellationEligibleUntilAt,
      blockCode: "SESSION_STARTED",
      cancellationBlockedReason: "Past bookings cannot be cancelled.",
    };
  }

  if (input.now >= cancellationEligibleUntilAt) {
    return {
      canCancel: false,
      cancellationEligibleUntilAt,
      blockCode: "WINDOW_PASSED",
      cancellationBlockedReason: `Booking can no longer be cancelled less than ${input.cancellationWindowHours} hour(s) before session start.`,
    };
  }

  return {
    canCancel: true,
    cancellationEligibleUntilAt,
    blockCode: null,
    cancellationBlockedReason: null,
  };
}

