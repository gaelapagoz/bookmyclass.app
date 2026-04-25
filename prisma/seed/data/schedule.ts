import { Weekday } from "@prisma/client";

export type AgendaScheduleEntry = {
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  label: string;
  displayOrder: number;
};

/**
 * Deterministic studio weekly agenda schedule.
 * Shared between development and production seed modes.
 * Maps to SiteWeeklyScheduleEntry (serviceId left null — public schedule display).
 */
export const AGENDA_SCHEDULE: AgendaScheduleEntry[] = [
  // Monday
  { dayOfWeek: Weekday.MONDAY, startTime: "07:00", endTime: "07:30", label: "Vinyasa Flow", displayOrder: 1 },
  { dayOfWeek: Weekday.MONDAY, startTime: "09:00", endTime: "09:30", label: "Mat Pilates Core Lab", displayOrder: 2 },
  { dayOfWeek: Weekday.MONDAY, startTime: "12:00", endTime: "12:30", label: "Hatha Reset", displayOrder: 3 },
  { dayOfWeek: Weekday.MONDAY, startTime: "18:00", endTime: "18:30", label: "Functional Strength Express", displayOrder: 4 },
  { dayOfWeek: Weekday.MONDAY, startTime: "19:30", endTime: "20:00", label: "Vinyasa Flow", displayOrder: 5 },

  // Tuesday
  { dayOfWeek: Weekday.TUESDAY, startTime: "07:30", endTime: "08:00", label: "Mat Pilates Core Lab", displayOrder: 1 },
  { dayOfWeek: Weekday.TUESDAY, startTime: "09:00", endTime: "09:30", label: "Rocket Yoga Power Sequence", displayOrder: 2 },
  { dayOfWeek: Weekday.TUESDAY, startTime: "18:00", endTime: "18:30", label: "Reformer Foundations", displayOrder: 3 },
  { dayOfWeek: Weekday.TUESDAY, startTime: "19:30", endTime: "20:00", label: "Mat Pilates Core Lab", displayOrder: 4 },

  // Wednesday
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "07:00", endTime: "07:30", label: "Vinyasa Flow", displayOrder: 1 },
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "09:00", endTime: "09:30", label: "Hatha Reset", displayOrder: 2 },
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "12:00", endTime: "12:30", label: "Functional Strength Express", displayOrder: 3 },
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "18:00", endTime: "18:30", label: "Vinyasa Flow", displayOrder: 4 },
  { dayOfWeek: Weekday.WEDNESDAY, startTime: "19:30", endTime: "20:00", label: "Rocket Yoga Power Sequence", displayOrder: 5 },

  // Thursday
  { dayOfWeek: Weekday.THURSDAY, startTime: "07:30", endTime: "08:00", label: "Mat Pilates Core Lab", displayOrder: 1 },
  { dayOfWeek: Weekday.THURSDAY, startTime: "09:00", endTime: "09:30", label: "Reformer Foundations", displayOrder: 2 },
  { dayOfWeek: Weekday.THURSDAY, startTime: "18:00", endTime: "18:30", label: "Mat Pilates Core Lab", displayOrder: 3 },
  { dayOfWeek: Weekday.THURSDAY, startTime: "19:30", endTime: "20:00", label: "Functional Strength Express", displayOrder: 4 },

  // Friday
  { dayOfWeek: Weekday.FRIDAY, startTime: "07:00", endTime: "07:30", label: "Hatha Reset", displayOrder: 1 },
  { dayOfWeek: Weekday.FRIDAY, startTime: "09:00", endTime: "09:30", label: "Functional Strength Express", displayOrder: 2 },
  { dayOfWeek: Weekday.FRIDAY, startTime: "12:00", endTime: "12:30", label: "Mat Pilates Core Lab", displayOrder: 3 },
  { dayOfWeek: Weekday.FRIDAY, startTime: "18:00", endTime: "18:30", label: "Functional Strength Express", displayOrder: 4 },
  { dayOfWeek: Weekday.FRIDAY, startTime: "19:30", endTime: "20:00", label: "Vinyasa Flow", displayOrder: 5 },

  // Saturday
  { dayOfWeek: Weekday.SATURDAY, startTime: "09:00", endTime: "09:30", label: "Vinyasa Flow", displayOrder: 1 },
  { dayOfWeek: Weekday.SATURDAY, startTime: "10:30", endTime: "11:00", label: "Mat Pilates Core Lab", displayOrder: 2 },
  { dayOfWeek: Weekday.SATURDAY, startTime: "12:00", endTime: "12:30", label: "Hatha Reset", displayOrder: 3 },

  // Sunday
  { dayOfWeek: Weekday.SUNDAY, startTime: "09:30", endTime: "10:00", label: "Hatha Reset", displayOrder: 1 },
  { dayOfWeek: Weekday.SUNDAY, startTime: "11:00", endTime: "11:30", label: "Vinyasa Flow", displayOrder: 2 },
];
