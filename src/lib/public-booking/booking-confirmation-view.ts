import { BookingPaymentSelection, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudioDateKey, getStudioTimeLabel } from "@/lib/public-catalogue/timezone";

export type BookingConfirmationView = {
  className: string | null;
  date: string | null;
  endTime: string | null;
  paymentSelection: BookingPaymentSelection | null;
  serviceSlug: string | null;
  startTime: string | null;
  status: BookingStatus | null;
};

export async function getBookingConfirmationView(input: {
  bookingId: string;
  userId: string;
}): Promise<BookingConfirmationView | null> {
  const booking = await prisma.booking.findFirst({
    where: {
      id: input.bookingId,
      clientId: input.userId,
    },
    select: {
      status: true,
      paymentSelection: true,
      studioSession: {
        select: {
          startsAt: true,
          endsAt: true,
          classType: {
            select: {
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!booking) {
    return null;
  }

  return {
    status: booking.status,
    paymentSelection: booking.paymentSelection,
    className: booking.studioSession.classType.name,
    serviceSlug: booking.studioSession.classType.slug,
    date: getStudioDateKey(booking.studioSession.startsAt),
    startTime: getStudioTimeLabel(booking.studioSession.startsAt),
    endTime: getStudioTimeLabel(booking.studioSession.endsAt),
  };
}
