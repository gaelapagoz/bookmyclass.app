import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import {
  BookingPaymentOptionsError,
  selectBookingPaymentOption,
} from "../../../../../lib/public-booking/booking-payment-options-service";

const BOOKING_ID_PATTERN = /^[a-z0-9]{8,}$/i;

const selectSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("EXISTING_PLAN"),
    entitlementId: z.string().min(8),
  }),
  z.object({
    mode: z.literal("NEW_PLAN_PURCHASE"),
    priceId: z.string().min(8),
  }),
  z.object({
    mode: z.literal("SINGLE_SESSION"),
    priceId: z.string().min(8),
  }),
]);

function toStatus(code: BookingPaymentOptionsError["code"]): number {
  switch (code) {
    case "NOT_AUTHENTICATED":
      return 401;
    case "BOOKING_NOT_FOUND":
      return 404;
    case "BOOKING_NOT_PENDING":
      return 409;
    case "BOOKING_NOT_OWNED":
      return 403;
    case "SESSION_NOT_BOOKABLE":
      return 400;
    case "PLAN_NOT_FOUND":
      return 404;
    case "PLAN_NOT_USABLE":
    case "PRICE_NOT_ELIGIBLE":
      return 400;
    default:
      return 400;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await context.params;

  if (!BOOKING_ID_PATTERN.test(bookingId)) {
    return Response.json({ error: "Invalid booking id." }, { status: 400 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = selectSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payment selection payload." }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const selection =
      parsed.data.mode === "EXISTING_PLAN"
        ? await selectBookingPaymentOption({
            bookingId,
            userId,
            mode: "EXISTING_PLAN",
            entitlementId: parsed.data.entitlementId,
          })
        : await selectBookingPaymentOption({
            bookingId,
            userId,
            mode: parsed.data.mode,
            priceId: parsed.data.priceId,
          });

    return Response.json({ selection }, { status: 200 });
  } catch (error) {
    if (error instanceof BookingPaymentOptionsError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatus(error.code) });
    }

    return Response.json({ error: "Unexpected error while applying selection." }, { status: 500 });
  }
}
