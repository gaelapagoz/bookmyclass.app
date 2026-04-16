"use server";

import { revalidatePath } from "next/cache";
import { checkInBooking } from "@/lib/attendance/attendance-service";
import { AttendanceSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireStaffSession } from "@/lib/auth/require-auth";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

export async function checkInBookingFromKiosk(input: { bookingId: string; sessionId: string }) {
  await assertSameOriginServerAction();
  const session = await requireStaffSession({
    callbackUrl: `/kiosk/${input.sessionId}`,
    unauthorizedPath: "/sign-in",
  });

  if (!input.bookingId || !input.sessionId) {
    throw new Error("INVALID_REQUEST");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, clientId: true, studioSessionId: true },
  });

  if (!booking) {
    throw new Error("BOOKING_NOT_FOUND");
  }

  if (booking.studioSessionId !== input.sessionId) {
    throw new Error("BOOKING_SESSION_MISMATCH");
  }

  if (!booking.clientId) {
    throw new Error("BOOKING_CLIENT_MISSING");
  }

  await checkInBooking({
    bookingId: input.bookingId,
    clientId: booking.clientId,
    source: AttendanceSource.KIOSK,
    markedById: session.user.id,
  });

  revalidatePath(`/kiosk/${input.sessionId}`);
  revalidatePath("/kiosk");
}
