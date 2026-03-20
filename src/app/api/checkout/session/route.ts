import { z } from "zod";
import { auth } from "../../../../auth";
import {
  CheckoutError,
  createCheckoutSessionForBooking,
} from "../../../../lib/public-booking/checkout-service";

const payloadSchema = z.object({
  bookingId: z.string().min(8),
});

function toStatus(code: CheckoutError["code"]): number {
  switch (code) {
    case "BOOKING_NOT_FOUND":
      return 404;
    case "BOOKING_NOT_PENDING":
      return 409;
    case "AUTH_REQUIRED":
      return 401;
    case "INVALID_SELECTION":
    case "MISSING_DRAFT_TOTAL":
      return 400;
    default:
      return 400;
  }
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: "Invalid checkout payload." }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  try {
    const checkout = await createCheckoutSessionForBooking({
      bookingId: parsed.data.bookingId,
      userId,
    });

    return Response.json({ checkout }, { status: 200 });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatus(error.code) });
    }

    const details = error instanceof Error ? error.message : "Unknown error";
    if (process.env.NODE_ENV !== "production") {
      console.error("[checkout/session] unexpected error", error);
    }

    return Response.json(
      {
        error: "Unexpected error while creating checkout session.",
        ...(process.env.NODE_ENV !== "production" ? { details } : {}),
      },
      { status: 500 },
    );
  }
}
