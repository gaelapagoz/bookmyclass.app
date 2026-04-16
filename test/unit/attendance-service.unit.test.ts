import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceSource, AttendanceStatus } from "@prisma/client";

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    bookingPolicy: {
      upsert: vi.fn(),
    },
    booking: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    attendanceRecord: {
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: dbMock,
}));

import {
  getStaffAttendanceTransitionAvailability,
  markBookingAttendanceByStaff,
  checkInBooking,
  getAttendanceWindowPolicy,
  getSessionCheckInWindow,
  isWithinCheckInWindow,
  isAfterCheckInWindow,
  isBeforeCheckInWindow,
  assertBookingNotCheckedInForCancellation,
} from "../../src/lib/attendance/attendance-service";

describe("attendance service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns allowed staff transitions from current attendance status", () => {
    expect(getStaffAttendanceTransitionAvailability(null)).toEqual({
      canMarkCheckedIn: true,
      canMarkAttended: true,
      canMarkNoShow: true,
      canClearCheckedIn: false,
    });

    expect(getStaffAttendanceTransitionAvailability(AttendanceStatus.CHECKED_IN)).toEqual({
      canMarkCheckedIn: true,
      canMarkAttended: true,
      canMarkNoShow: true,
      canClearCheckedIn: true,
    });

    expect(getStaffAttendanceTransitionAvailability(AttendanceStatus.ATTENDED)).toEqual({
      canMarkCheckedIn: false,
      canMarkAttended: false,
      canMarkNoShow: false,
      canClearCheckedIn: false,
    });
  });

  it("returns a valid check-in window from a policy", () => {
    const start = new Date("2026-04-15T10:00:00.000Z");
    const window = getSessionCheckInWindow(start, {
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    });

    expect(window.opensAt.toISOString()).toBe("2026-04-15T09:45:00.000Z");
    expect(window.closesAt.toISOString()).toBe("2026-04-15T10:10:00.000Z");
    expect(isWithinCheckInWindow(start, new Date("2026-04-15T10:05:00.000Z"), {
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    })).toBe(true);
    expect(isBeforeCheckInWindow(start, new Date("2026-04-15T09:30:00.000Z"), {
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    })).toBe(true);
    expect(isAfterCheckInWindow(start, new Date("2026-04-15T10:20:00.000Z"), {
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    })).toBe(true);
  });

  it("creates a check-in on first valid self check-in", async () => {
    dbMock.bookingPolicy.upsert.mockResolvedValue({
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    });

    dbMock.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      clientId: "client-1",
      status: "CONFIRMED",
      studioSession: {
        startsAt: new Date(Date.now() - 5 * 60 * 1000),
        status: "SCHEDULED",
        classType: {
          category: { slug: "collective-classes" },
        },
      },
      attendanceRecord: null,
    });

    dbMock.attendanceRecord.create.mockResolvedValue({
      id: "attendance-1",
      status: AttendanceStatus.CHECKED_IN,
      source: AttendanceSource.DASHBOARD,
    });

    const result = await checkInBooking({
      bookingId: "booking-1",
      clientId: "client-1",
      source: AttendanceSource.DASHBOARD,
    });

    expect(dbMock.attendanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "booking-1",
          status: AttendanceStatus.CHECKED_IN,
          source: AttendanceSource.DASHBOARD,
          markedById: "client-1",
        }),
      }),
    );
    expect(result).toEqual({
      attendanceRecordId: "attendance-1",
      status: AttendanceStatus.CHECKED_IN,
      source: AttendanceSource.DASHBOARD,
    });
  });

  it("updates an existing CHECKED_IN attendance record idempotently", async () => {
    dbMock.bookingPolicy.upsert.mockResolvedValue({
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    });

    dbMock.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      clientId: "client-1",
      status: "CONFIRMED",
      studioSession: {
        startsAt: new Date(Date.now() - 5 * 60 * 1000),
        status: "SCHEDULED",
        classType: {
          category: { slug: "collective-classes" },
        },
      },
      attendanceRecord: {
        id: "attendance-1",
        status: AttendanceStatus.CHECKED_IN,
      },
    });

    dbMock.attendanceRecord.update.mockResolvedValue({
      id: "attendance-1",
      status: AttendanceStatus.CHECKED_IN,
      source: AttendanceSource.KIOSK,
    });

    const result = await checkInBooking({
      bookingId: "booking-1",
      clientId: "client-1",
      source: AttendanceSource.KIOSK,
    });

    expect(dbMock.attendanceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "booking-1" },
        data: expect.objectContaining({
          source: AttendanceSource.KIOSK,
          markedById: "client-1",
        }),
      }),
    );
    expect(result.source).toBe(AttendanceSource.KIOSK);
  });

  it("uses explicit markedById when provided", async () => {
    dbMock.bookingPolicy.upsert.mockResolvedValue({
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    });

    dbMock.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      clientId: "client-1",
      status: "CONFIRMED",
      studioSession: {
        startsAt: new Date(Date.now() - 5 * 60 * 1000),
        status: "SCHEDULED",
        classType: {
          category: { slug: "collective-classes" },
        },
      },
      attendanceRecord: null,
    });

    dbMock.attendanceRecord.create.mockResolvedValue({
      id: "attendance-1",
      status: AttendanceStatus.CHECKED_IN,
      source: AttendanceSource.KIOSK,
    });

    await checkInBooking({
      bookingId: "booking-1",
      clientId: "client-1",
      source: AttendanceSource.KIOSK,
      markedById: "staff-1",
    });

    expect(dbMock.attendanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          markedById: "staff-1",
        }),
      }),
    );
  });

  it("blocks cancellation when an attendance record exists", async () => {
    dbMock.attendanceRecord.findUnique.mockResolvedValue({ id: "attendance-1" });

    await expect(assertBookingNotCheckedInForCancellation("booking-1")).rejects.toThrow(
      "BOOKING_ALREADY_CHECKED_IN",
    );
  });

  it("allows staff transition from CHECKED_IN to ATTENDED", async () => {
    dbMock.$transaction.mockResolvedValueOnce([
      { id: "admin-1", role: "ADMIN" },
      {
        id: "booking-1",
        status: "CONFIRMED",
        studioSession: { teacherId: "teacher-1" },
        attendanceRecord: {
          id: "attendance-1",
          status: AttendanceStatus.CHECKED_IN,
          source: AttendanceSource.KIOSK,
        },
      },
    ]);

    dbMock.attendanceRecord.update.mockResolvedValue({
      id: "attendance-1",
      status: AttendanceStatus.ATTENDED,
      source: AttendanceSource.KIOSK,
      markedAt: new Date("2026-04-15T10:05:00.000Z"),
    });

    const result = await markBookingAttendanceByStaff({
      bookingId: "booking-1",
      studioSessionId: "session-1",
      actorUserId: "admin-1",
      targetStatus: AttendanceStatus.ATTENDED,
    });

    expect(dbMock.attendanceRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { bookingId: "booking-1" },
        data: expect.objectContaining({
          status: AttendanceStatus.ATTENDED,
          markedById: "admin-1",
        }),
      }),
    );
    expect(result.action).toBe("UPDATED");
    expect(result.status).toBe(AttendanceStatus.ATTENDED);
  });

  it("allows staff to create NO_SHOW directly from no attendance", async () => {
    dbMock.$transaction.mockResolvedValueOnce([
      { id: "admin-1", role: "ADMIN" },
      {
        id: "booking-1",
        status: "CONFIRMED",
        studioSession: { teacherId: "teacher-1" },
        attendanceRecord: null,
      },
    ]);

    dbMock.attendanceRecord.create.mockResolvedValue({
      id: "attendance-2",
      status: AttendanceStatus.NO_SHOW,
      source: AttendanceSource.DASHBOARD,
      markedAt: new Date("2026-04-15T10:05:00.000Z"),
    });

    const result = await markBookingAttendanceByStaff({
      bookingId: "booking-1",
      studioSessionId: "session-1",
      actorUserId: "admin-1",
      targetStatus: AttendanceStatus.NO_SHOW,
    });

    expect(dbMock.attendanceRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "booking-1",
          status: AttendanceStatus.NO_SHOW,
          markedById: "admin-1",
        }),
      }),
    );
    expect(result.action).toBe("CREATED");
    expect(result.status).toBe(AttendanceStatus.NO_SHOW);
  });

  it("allows staff clearing CHECKED_IN attendance", async () => {
    dbMock.$transaction.mockResolvedValueOnce([
      { id: "admin-1", role: "ADMIN" },
      {
        id: "booking-1",
        status: "CONFIRMED",
        studioSession: { teacherId: "teacher-1" },
        attendanceRecord: {
          id: "attendance-1",
          status: AttendanceStatus.CHECKED_IN,
          source: AttendanceSource.DASHBOARD,
        },
      },
    ]);

    await markBookingAttendanceByStaff({
      bookingId: "booking-1",
      studioSessionId: "session-1",
      actorUserId: "admin-1",
      targetStatus: "CLEAR",
    });

    expect(dbMock.attendanceRecord.delete).toHaveBeenCalledWith({
      where: { bookingId: "booking-1" },
    });
  });

  it("rejects changing finalized attendance status", async () => {
    dbMock.$transaction.mockResolvedValueOnce([
      { id: "admin-1", role: "ADMIN" },
      {
        id: "booking-1",
        status: "CONFIRMED",
        studioSession: { teacherId: "teacher-1" },
        attendanceRecord: {
          id: "attendance-1",
          status: AttendanceStatus.ATTENDED,
          source: AttendanceSource.DASHBOARD,
        },
      },
    ]);

    await expect(markBookingAttendanceByStaff({
      bookingId: "booking-1",
      studioSessionId: "session-1",
      actorUserId: "admin-1",
      targetStatus: AttendanceStatus.NO_SHOW,
    })).rejects.toThrow("ATTENDANCE_ALREADY_FINALIZED");
  });

  it("handles concurrent self check-in requests with single successful record creation", async () => {
    dbMock.bookingPolicy.upsert.mockResolvedValue({
      checkInOpensMinutesBefore: 15,
      checkInClosesMinutesAfter: 10,
    });

    dbMock.booking.findUnique.mockResolvedValue({
      id: "booking-1",
      clientId: "client-1",
      status: "CONFIRMED",
      studioSession: {
        startsAt: new Date(Date.now() - 5 * 60 * 1000),
        status: "SCHEDULED",
        classType: {
          category: { slug: "collective-classes" },
        },
      },
      attendanceRecord: null,
    });

    dbMock.attendanceRecord.create
      .mockResolvedValueOnce({
        id: "attendance-1",
        status: AttendanceStatus.CHECKED_IN,
        source: AttendanceSource.KIOSK,
      })
      .mockRejectedValueOnce(new Error("P2002"));

    const results = await Promise.allSettled([
      checkInBooking({
        bookingId: "booking-1",
        clientId: "client-1",
        source: AttendanceSource.KIOSK,
      }),
      checkInBooking({
        bookingId: "booking-1",
        clientId: "client-1",
        source: AttendanceSource.KIOSK,
      }),
    ]);

    const fulfilledCount = results.filter((result) => result.status === "fulfilled").length;
    const rejectedCount = results.filter((result) => result.status === "rejected").length;
    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);
  });
});
