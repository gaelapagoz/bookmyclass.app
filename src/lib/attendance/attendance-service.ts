import {
  AttendanceSource,
  AttendanceStatus,
  BookingStatus,
  Role,
  StudioSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getStaffAttendanceTransitionAvailability,
} from "@/lib/attendance/attendance-transitions";
import { getSiteTimeLabel } from "@/lib/public-catalogue/timezone";
import { DEFAULT_SITE_TIME_ZONE } from "@/lib/site-settings/site-timezone";
import { getSiteTimeZone } from "@/lib/site-settings/site-settings-service";

export type AttendanceWindowPolicy = {
  checkInOpensMinutesBefore: number;
  checkInClosesMinutesAfter: number;
};

export type AttendanceCheckInWindow = {
  opensAt: Date;
  opensAtLabel: string;
  closesAt: Date;
  closesAtLabel: string;
};

export type AttendanceEligibilityResult = {
  attendanceStatus: AttendanceStatus | null;
  isPrivateClass: boolean;
  isConfirmedBooking: boolean;
  isSessionScheduled: boolean;
  isWithinWindow: boolean;
  isBeforeWindow: boolean;
  isAfterWindow: boolean;
  timeZone: string;
  window: AttendanceCheckInWindow;
};

export type StaffAttendanceTargetStatus = AttendanceStatus | "CLEAR";

type StaffAttendanceMutationResult =
  | {
    action: "CREATED" | "UPDATED";
    attendanceRecordId: string;
    status: AttendanceStatus;
    source: AttendanceSource;
    markedAt: Date;
  }
  | {
    action: "CLEARED";
    previousStatus: AttendanceStatus;
  };

export async function getAttendanceWindowPolicy(): Promise<AttendanceWindowPolicy> {
  const existing = await prisma.bookingPolicy.findFirst({
    where: { scope: "GLOBAL" },
    select: { checkInOpensMinutesBefore: true, checkInClosesMinutesAfter: true },
  });
  if (existing) {
    return {
      checkInOpensMinutesBefore: existing.checkInOpensMinutesBefore,
      checkInClosesMinutesAfter: existing.checkInClosesMinutesAfter,
    };
  }

  try {
    const created = await prisma.bookingPolicy.create({
      data: { scope: "GLOBAL", cancellationCutoffHours: 24, checkInOpensMinutesBefore: 15, checkInClosesMinutesAfter: 10 },
      select: { checkInOpensMinutesBefore: true, checkInClosesMinutesAfter: true },
    });
    return { checkInOpensMinutesBefore: created.checkInOpensMinutesBefore, checkInClosesMinutesAfter: created.checkInClosesMinutesAfter };
  } catch {
    // Race: another concurrent request created it — read it back.
    const fallback = await prisma.bookingPolicy.findFirst({
      where: { scope: "GLOBAL" },
      select: { checkInOpensMinutesBefore: true, checkInClosesMinutesAfter: true },
    });
    return {
      checkInOpensMinutesBefore: fallback?.checkInOpensMinutesBefore ?? 15,
      checkInClosesMinutesAfter: fallback?.checkInClosesMinutesAfter ?? 10,
    };
  }
}

export function getSessionCheckInWindow(
  sessionStartsAt: Date,
  policy: AttendanceWindowPolicy,
  timeZone?: string,
): AttendanceCheckInWindow {
  const opensAt = new Date(sessionStartsAt.getTime() - policy.checkInOpensMinutesBefore * 60 * 1000);
  const closesAt = new Date(sessionStartsAt.getTime() + policy.checkInClosesMinutesAfter * 60 * 1000);
  return {
    opensAt,
    opensAtLabel: getSiteTimeLabel(opensAt, timeZone ?? DEFAULT_SITE_TIME_ZONE),
    closesAt,
    closesAtLabel: getSiteTimeLabel(closesAt, timeZone ?? DEFAULT_SITE_TIME_ZONE),
  };
}

export function isWithinCheckInWindow(
  sessionStartsAt: Date,
  now: Date,
  policy: AttendanceWindowPolicy,
): boolean {
  const window = getSessionCheckInWindow(sessionStartsAt, policy);
  return now >= window.opensAt && now <= window.closesAt;
}

export function isBeforeCheckInWindow(
  sessionStartsAt: Date,
  now: Date,
  policy: AttendanceWindowPolicy,
): boolean {
  return now < getSessionCheckInWindow(sessionStartsAt, policy).opensAt;
}

export function isAfterCheckInWindow(
  sessionStartsAt: Date,
  now: Date,
  policy: AttendanceWindowPolicy,
): boolean {
  return now > getSessionCheckInWindow(sessionStartsAt, policy).closesAt;
}

function isPrivateClassCategorySlug(categorySlug: string | null | undefined): boolean {
  return Boolean(categorySlug?.toLowerCase().includes("private"));
}

export { getStaffAttendanceTransitionAvailability };

function isStaffRole(role: Role): boolean {
  return role === Role.ADMIN || role === Role.MASTER_ADMIN || role === Role.TEACHER;
}

function assertStaffAttendanceTransitionAllowed(input: {
  currentStatus: AttendanceStatus | null;
  targetStatus: StaffAttendanceTargetStatus;
}) {
  if (input.targetStatus === "CLEAR") {
    if (!input.currentStatus) {
      throw new Error("ATTENDANCE_NOT_FOUND");
    }
    if (input.currentStatus !== AttendanceStatus.CHECKED_IN) {
      throw new Error("ATTENDANCE_ALREADY_FINALIZED");
    }
    return;
  }

  if (!input.currentStatus) {
    return;
  }

  if (input.currentStatus === AttendanceStatus.CHECKED_IN) {
    if (
      input.targetStatus === AttendanceStatus.CHECKED_IN
      || input.targetStatus === AttendanceStatus.ATTENDED
      || input.targetStatus === AttendanceStatus.NO_SHOW
    ) {
      return;
    }
  }

  throw new Error("ATTENDANCE_ALREADY_FINALIZED");
}

export async function assertBookingNotCheckedInForCancellation(bookingId: string): Promise<void> {
  const attendanceRecord = await prisma.attendanceRecord.findUnique({
    where: { bookingId },
    select: { id: true },
  });

  if (attendanceRecord) {
    throw new Error("BOOKING_ALREADY_CHECKED_IN");
  }
}

export async function getBookingSelfCheckInEligibility(bookingId: string, _clientId: string) {
  const now = new Date();
  const [policy, timeZone] = await Promise.all([getAttendanceWindowPolicy(), getSiteTimeZone()]);

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      studioSession: {
        select: {
          id: true,
          startsAt: true,
          status: true,
          classType: {
            select: {
              category: {
                select: {
                  slug: true,
                },
              },
            },
          },
        },
      },
      attendanceRecord: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!booking) {
    throw new Error("BOOKING_NOT_FOUND");
  }

  const isPrivateClass = isPrivateClassCategorySlug(booking.studioSession.classType.category?.slug);
  const window = getSessionCheckInWindow(booking.studioSession.startsAt, policy, timeZone);

  return {
    isPrivateClass,
    isConfirmedBooking: booking.status === BookingStatus.CONFIRMED,
    isSessionScheduled: booking.studioSession.status === StudioSessionStatus.SCHEDULED,
    isWithinWindow: booking.status === BookingStatus.CONFIRMED
      ? isWithinCheckInWindow(booking.studioSession.startsAt, now, policy)
      : false,
    isBeforeWindow: isBeforeCheckInWindow(booking.studioSession.startsAt, now, policy),
    isAfterWindow: isAfterCheckInWindow(booking.studioSession.startsAt, now, policy),
    window,
    timeZone,
    attendanceStatus: booking.attendanceRecord?.status ?? null,
  };
}

export async function checkInBooking(input: {
  bookingId: string;
  clientId: string;
  source: AttendanceSource;
  markedById?: string;
}): Promise<{
  attendanceRecordId: string;
  status: AttendanceStatus;
  source: AttendanceSource;
}> {
  const now = new Date();
  const [policy, timeZone] = await Promise.all([getAttendanceWindowPolicy(), getSiteTimeZone()]);
  const markedById = input.markedById ?? input.clientId;

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      clientId: true,
      status: true,
      studioSession: {
        select: {
          id: true,
          startsAt: true,
          status: true,
          classType: {
            select: {
              category: {
                select: {
                  slug: true,
                },
              },
            },
          },
        },
      },
      attendanceRecord: {
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  if (!booking) {
    throw new Error("BOOKING_NOT_FOUND");
  }

  if (booking.clientId !== input.clientId) {
    throw new Error("BOOKING_NOT_OWNED");
  }

  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new Error("BOOKING_NOT_CONFIRMED");
  }

  if (booking.studioSession.status !== StudioSessionStatus.SCHEDULED) {
    throw new Error("SESSION_NOT_SCHEDULED");
  }

  if (isPrivateClassCategorySlug(booking.studioSession.classType.category?.slug)) {
    throw new Error("PRIVATE_CLASSES_NOT_ELIGIBLE_FOR_CHECKIN");
  }

  const checkInWindow = getSessionCheckInWindow(booking.studioSession.startsAt, policy, timeZone);
  if (now < checkInWindow.opensAt || now > checkInWindow.closesAt) {
    throw new Error("CHECKIN_WINDOW_CLOSED");
  }

  if (booking.attendanceRecord) {
    if (booking.attendanceRecord.status === AttendanceStatus.CHECKED_IN) {
      const record = await prisma.attendanceRecord.update({
        where: { bookingId: booking.id },
        data: {
          markedAt: now,
          source: input.source,
          markedById,
        },
      });
      return {
        attendanceRecordId: record.id,
        status: record.status,
        source: record.source,
      };
    }

    throw new Error("BOOKING_ALREADY_FINALIZED_FOR_ATTENDANCE");
  }

  const record = await prisma.attendanceRecord.create({
    data: {
      bookingId: booking.id,
      status: AttendanceStatus.CHECKED_IN,
      source: input.source,
      markedAt: now,
      markedById,
    },
  });

  return {
    attendanceRecordId: record.id,
    status: record.status,
    source: record.source,
  };
}

export async function markBookingAttendanceByStaff(input: {
  bookingId: string;
  studioSessionId: string;
  actorUserId: string;
  targetStatus: StaffAttendanceTargetStatus;
  notes?: string;
}): Promise<StaffAttendanceMutationResult> {
  const now = new Date();
  const normalizedNotes = input.notes?.trim() || null;

  const [actorUser, booking] = await prisma.$transaction([
    prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: {
        id: true,
        role: true,
      },
    }),
    prisma.booking.findFirst({
      where: {
        id: input.bookingId,
        studioSessionId: input.studioSessionId,
      },
      select: {
        id: true,
        status: true,
        studioSession: {
          select: {
            teacherId: true,
          },
        },
        attendanceRecord: {
          select: {
            id: true,
            status: true,
            source: true,
          },
        },
      },
    }),
  ]);

  if (!actorUser || !isStaffRole(actorUser.role)) {
    throw new Error("SESSION_MANAGER_FORBIDDEN");
  }

  if (!booking) {
    throw new Error("SESSION_ATTENDEE_NOT_FOUND");
  }

  if (actorUser.role === Role.TEACHER && booking.studioSession.teacherId !== actorUser.id) {
    throw new Error("TEACHER_SESSION_FORBIDDEN");
  }

  if (booking.status !== BookingStatus.CONFIRMED) {
    throw new Error("BOOKING_NOT_CONFIRMED");
  }

  const currentStatus = booking.attendanceRecord?.status ?? null;
  assertStaffAttendanceTransitionAllowed({
    currentStatus,
    targetStatus: input.targetStatus,
  });

  if (input.targetStatus === "CLEAR") {
    await prisma.attendanceRecord.delete({
      where: {
        bookingId: booking.id,
      },
    });

    return {
      action: "CLEARED",
      previousStatus: AttendanceStatus.CHECKED_IN,
    };
  }

  if (!booking.attendanceRecord) {
    const created = await prisma.attendanceRecord.create({
      data: {
        bookingId: booking.id,
        status: input.targetStatus,
        source: AttendanceSource.DASHBOARD,
        markedAt: now,
        markedById: actorUser.id,
        notes: normalizedNotes,
      },
      select: {
        id: true,
        status: true,
        source: true,
        markedAt: true,
      },
    });

    return {
      action: "CREATED",
      attendanceRecordId: created.id,
      status: created.status,
      source: created.source,
      markedAt: created.markedAt,
    };
  }

  const updated = await prisma.attendanceRecord.update({
    where: {
      bookingId: booking.id,
    },
    data: {
      status: input.targetStatus,
      // Preserve original source for checked-in records, but mark DASHBOARD for direct staff records.
      source: booking.attendanceRecord.source ?? AttendanceSource.DASHBOARD,
      markedAt: now,
      markedById: actorUser.id,
      notes: normalizedNotes,
    },
    select: {
      id: true,
      status: true,
      source: true,
      markedAt: true,
    },
  });

  return {
    action: "UPDATED",
    attendanceRecordId: updated.id,
    status: updated.status,
    source: updated.source,
    markedAt: updated.markedAt,
  };
}
