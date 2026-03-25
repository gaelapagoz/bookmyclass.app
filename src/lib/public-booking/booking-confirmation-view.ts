import { BookingPaymentSelection, BookingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getPublicTeacherName } from "../public-content/teacher-display";
import { formatSessionDateTime } from "./format-session-date-time";

export type BookingConfirmationView = {
  className: string | null;
  dateTime: string | null;
  locationName: string | null;
  paymentSelection: BookingPaymentSelection | null;
  serviceSlug: string | null;
  status: BookingStatus | null;
  teacherName: string | null;
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
          location: true,
          teacher: {
            select: {
              firstName: true,
              lastName: true,
              name: true,
            },
          },
          classTemplate: {
            select: {
              location: true,
            },
          },
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
    dateTime: formatSessionDateTime({
      startsAt: booking.studioSession.startsAt,
      endsAt: booking.studioSession.endsAt,
    }),
    teacherName: getPublicTeacherName(booking.studioSession.teacher),
    locationName:
      booking.studioSession.location?.trim() || booking.studioSession.classTemplate.location?.trim() || null,
  };
}
