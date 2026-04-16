import { AttendanceStatus } from "@prisma/client";

export type StaffAttendanceTransitionAvailability = {
  canMarkCheckedIn: boolean;
  canMarkAttended: boolean;
  canMarkNoShow: boolean;
  canClearCheckedIn: boolean;
};

export function getStaffAttendanceTransitionAvailability(
  currentStatus: AttendanceStatus | null,
): StaffAttendanceTransitionAvailability {
  if (!currentStatus) {
    return {
      canMarkCheckedIn: true,
      canMarkAttended: true,
      canMarkNoShow: true,
      canClearCheckedIn: false,
    };
  }

  if (currentStatus === AttendanceStatus.CHECKED_IN) {
    return {
      canMarkCheckedIn: true,
      canMarkAttended: true,
      canMarkNoShow: true,
      canClearCheckedIn: true,
    };
  }

  return {
    canMarkCheckedIn: false,
    canMarkAttended: false,
    canMarkNoShow: false,
    canClearCheckedIn: false,
  };
}

