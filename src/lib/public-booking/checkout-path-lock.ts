import type { Prisma } from "@prisma/client";

export const BOOKING_CHECKOUT_PATH = {
  LEGACY_BOOKING: "LEGACY_BOOKING",
  CANONICAL_CART: "CANONICAL_CART",
} as const;

export type BookingCheckoutPathValue =
  (typeof BOOKING_CHECKOUT_PATH)[keyof typeof BOOKING_CHECKOUT_PATH];

export class BookingCheckoutPathLockError extends Error {
  constructor(
    public readonly code: "CHECKOUT_PATH_CONFLICT" | "CHECKOUT_PATH_PERSISTENCE_FAILED",
    message: string,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

export async function lockBookingCheckoutPath(input: {
  tx: Tx;
  bookingId: string;
  requiredPath: BookingCheckoutPathValue;
}): Promise<void> {
  const booking = await input.tx.booking.findUnique({
    where: { id: input.bookingId },
    select: { checkoutPath: true },
  });

  if (!booking) {
    throw new BookingCheckoutPathLockError(
      "CHECKOUT_PATH_PERSISTENCE_FAILED",
      "Booking checkout path lock failed because the booking no longer exists.",
    );
  }

  if (booking.checkoutPath === input.requiredPath) {
    return;
  }

  if (booking.checkoutPath && booking.checkoutPath !== input.requiredPath) {
    throw new BookingCheckoutPathLockError(
      "CHECKOUT_PATH_CONFLICT",
      "Booking checkout path is immutable and already locked to another checkout path.",
    );
  }

  const write = await input.tx.booking.updateMany({
    where: {
      id: input.bookingId,
      checkoutPath: null,
    },
    data: {
      checkoutPath: input.requiredPath,
    },
  });

  if (write.count !== 1) {
    throw new BookingCheckoutPathLockError(
      "CHECKOUT_PATH_PERSISTENCE_FAILED",
      "Booking checkout path lock failed to persist.",
    );
  }
}
