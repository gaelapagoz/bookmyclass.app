import { auth } from "../../../../../auth";
import {
  BookingPaymentOptionsError,
  getBookingPaymentOptions,
} from "../../../../../lib/public-booking/booking-payment-options-service";

const BOOKING_ID_PATTERN = /^[a-z0-9]{8,}$/i;

function toStatus(code: BookingPaymentOptionsError["code"]): number {
  switch (code) {
    case "BOOKING_NOT_FOUND":
      return 404;
    case "BOOKING_NOT_PENDING":
      return 409;
    case "NOT_AUTHENTICATED":
      return 401;
    case "BOOKING_NOT_OWNED":
      return 403;
    case "SESSION_NOT_BOOKABLE":
      return 400;
    default:
      return 400;
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await context.params;

  if (!BOOKING_ID_PATTERN.test(bookingId)) {
    return Response.json({ error: "Invalid booking id." }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  try {
    const paymentOptions = await getBookingPaymentOptions({ bookingId, userId });
    return Response.json({ paymentOptions }, { status: 200 });
  } catch (error) {
    if (error instanceof BookingPaymentOptionsError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatus(error.code) });
    }

    return Response.json({ error: "Unexpected error while loading payment options." }, { status: 500 });
  }
}
