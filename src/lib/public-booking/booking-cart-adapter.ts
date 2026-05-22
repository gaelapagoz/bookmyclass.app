import { BookingPaymentSelection, BookingStatus } from "@prisma/client";

import { CART_CHECKOUT_SOURCE } from "@/lib/cart/cart-contract";
import { prisma } from "@/lib/db";

type BookingCartAdapterErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_PENDING"
  | "INVALID_SELECTION"
  | "MISSING_PRICE"
  | "AUTH_REQUIRED";

export class BookingCartAdapterError extends Error {
  constructor(
    public readonly code: BookingCartAdapterErrorCode,
    message: string,
  ) {
    super(message);
  }
}

type SupportedBookingSelection = Extract<
  BookingPaymentSelection,
  "SINGLE_SESSION" | "NEW_PLAN_PURCHASE"
>;

export type CanonicalBookingCartAdapterResult = {
  idempotencyKey: string;
  clientCartVersion: string;
  cartLines: Array<{ productId: string; priceId: string; quantity: number }>;
  metadata: {
    bookingId: string;
    serviceSlug: string;
    selection: SupportedBookingSelection;
    userId: string;
    priceId: string;
    productId: string;
    orderId: string;
    paymentId: string;
    source: typeof CART_CHECKOUT_SOURCE;
    checkoutOrigin: "BOOKING";
  };
};

function requireSupportedSelection(
  selection: BookingPaymentSelection | null,
): SupportedBookingSelection {
  if (selection === BookingPaymentSelection.SINGLE_SESSION) {
    return BookingPaymentSelection.SINGLE_SESSION;
  }
  if (selection === BookingPaymentSelection.NEW_PLAN_PURCHASE) {
    return BookingPaymentSelection.NEW_PLAN_PURCHASE;
  }
  throw new BookingCartAdapterError(
    "INVALID_SELECTION",
    "Booking selection is not supported by the canonical booking cart adapter.",
  );
}

export async function buildCanonicalBookingCartAdapterInput(input: {
  bookingId: string;
  userId: string | null;
}): Promise<CanonicalBookingCartAdapterResult> {
  const { bookingId, userId } = input;
  if (!userId) {
    throw new BookingCartAdapterError("AUTH_REQUIRED", "Authentication required.");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      paymentSelection: true,
      selectedPriceId: true,
      orderId: true,
      studioSession: {
        select: {
          classType: {
            select: {
              slug: true,
            },
          },
        },
      },
      selectedPrice: {
        select: {
          id: true,
          productId: true,
        },
      },
    },
  });

  if (!booking) {
    throw new BookingCartAdapterError("BOOKING_NOT_FOUND", "Booking draft not found.");
  }
  if (booking.status !== BookingStatus.PENDING) {
    throw new BookingCartAdapterError("BOOKING_NOT_PENDING", "Booking draft is not pending.");
  }
  if (!booking.clientId || booking.clientId !== userId) {
    throw new BookingCartAdapterError(
      "AUTH_REQUIRED",
      "Sign in with the booking account to continue checkout.",
    );
  }

  const selection = requireSupportedSelection(booking.paymentSelection);
  if (!booking.selectedPriceId || !booking.selectedPrice) {
    throw new BookingCartAdapterError(
      "MISSING_PRICE",
      "Booking draft does not have a selected price.",
    );
  }
  const serviceSlug = booking.studioSession?.classType?.slug;
  if (!serviceSlug) {
    throw new BookingCartAdapterError(
      "INVALID_SELECTION",
      "Booking draft session context is missing.",
    );
  }

  return {
    idempotencyKey: `bookcart_${booking.id}`,
    clientCartVersion: `booking:${booking.id}`,
    cartLines: [
      {
        productId: booking.selectedPrice.productId,
        priceId: booking.selectedPriceId,
        quantity: 1,
      },
    ],
    metadata: {
      bookingId: booking.id,
      serviceSlug,
      selection,
      userId,
      priceId: booking.selectedPrice.id,
      productId: booking.selectedPrice.productId,
      orderId: booking.orderId ?? "",
      paymentId: "",
      source: CART_CHECKOUT_SOURCE,
      checkoutOrigin: "BOOKING",
    },
  };
}
