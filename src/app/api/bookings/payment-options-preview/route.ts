import { BookingIntent } from "@prisma/client";
import { auth } from "../../../../auth";
import {
  BookingPaymentOptionsError,
  getBookingPaymentOptionsPreview,
} from "../../../../lib/public-booking/booking-payment-options-service";

function toStatus(code: BookingPaymentOptionsError["code"]): number {
  switch (code) {
    case "BOOKING_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const serviceSlug = searchParams.get("serviceSlug");
  const bookingIntent = searchParams.get("bookingIntent");

  if (!serviceSlug) {
    return Response.json({ error: "Missing serviceSlug." }, { status: 400 });
  }

  if (bookingIntent !== BookingIntent.SINGLE_BOOKING && bookingIntent !== BookingIntent.USE_PLAN) {
    return Response.json({ error: "Invalid bookingIntent." }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  try {
    const paymentOptions = await getBookingPaymentOptionsPreview({
      serviceSlug,
      bookingIntent,
      userId,
    });
    return Response.json({ paymentOptions }, { status: 200 });
  } catch (error) {
    if (error instanceof BookingPaymentOptionsError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatus(error.code) });
    }

    return Response.json({ error: "Unexpected error while loading payment options." }, { status: 500 });
  }
}
