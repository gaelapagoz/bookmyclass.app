"use client";

import { useState } from "react";

import type { Weekday } from "@prisma/client";

const weekdayItems: Array<{ value: Weekday; label: string }> = [
  { value: "MONDAY", label: "Mon" },
  { value: "TUESDAY", label: "Tue" },
  { value: "WEDNESDAY", label: "Wed" },
  { value: "THURSDAY", label: "Thu" },
  { value: "FRIDAY", label: "Fri" },
  { value: "SATURDAY", label: "Sat" },
  { value: "SUNDAY", label: "Sun" },
];

type Props = {
  teachers: Array<{ id: string; name: string }>;
  defaultValues?: {
    defaultTeacherId?: string;
    startTime?: string;
    endTime?: string;
    isRecurring?: boolean;
    date?: string | null;
    weekdays?: Weekday[];
    endDate?: string | null;
  };
};

export default function ClassScheduleFields({ teachers, defaultValues }: Props) {
  const [isRecurring, setIsRecurring] = useState(Boolean(defaultValues?.isRecurring));
  const [selectedWeekdays, setSelectedWeekdays] = useState<Set<Weekday>>(
    () => new Set(defaultValues?.weekdays ?? []),
  );

  function toggleWeekday(weekday: Weekday, isChecked: boolean) {
    setSelectedWeekdays((current) => {
      const next = new Set(current);
      if (isChecked) {
        next.add(weekday);
      } else {
        next.delete(weekday);
      }
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#1f2735]">Schedule</h2>
        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input
            type="checkbox"
            name="isRecurring"
            defaultChecked={isRecurring}
            onChange={(event) => setIsRecurring(event.target.checked)}
          />
          Recurring class
        </label>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <label className="block text-sm text-[#334155]">
          Default Teacher
          <select
            name="defaultTeacherId"
            required
            defaultValue={defaultValues?.defaultTeacherId ?? teachers[0]?.id ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          >
            {teachers.map((teacher) => (
              <option key={teacher.id} value={teacher.id}>
                {teacher.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-[#334155]">
          Start Time
          <input
            name="scheduleStartTime"
            type="time"
            required
            defaultValue={defaultValues?.startTime ?? "18:00"}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>
        <label className="block text-sm text-[#334155]">
          End Time
          <input
            name="scheduleEndTime"
            type="time"
            required
            defaultValue={defaultValues?.endTime ?? "19:00"}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>
      </div>

      {!isRecurring ? (
        <div className="mt-3 grid gap-2 md:max-w-xs">
          <label className="block text-sm text-[#334155]">
            Date
            <input
              name="scheduleDate"
              type="date"
              required={!isRecurring}
              defaultValue={defaultValues?.date ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <div className="mt-3 space-y-3 rounded-lg border border-[#e2e8f0] p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block text-sm text-[#334155]">
              Start Date
              <input
                name="scheduleDate"
                type="date"
                required={isRecurring}
                defaultValue={defaultValues?.date ?? ""}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              End Date
              <input
                name="endDate"
                type="date"
                required={isRecurring}
                defaultValue={defaultValues?.endDate ?? ""}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
          </div>

          <fieldset>
            <legend className="text-sm text-[#334155]">Repeat on</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {weekdayItems.map((weekday) => (
                <label
                  key={weekday.value}
                  className={`inline-flex min-w-11 cursor-pointer items-center justify-center rounded-full border px-3 py-1.5 text-xs ${
                    selectedWeekdays.has(weekday.value)
                      ? "border-[#1d3652] bg-[#1d3652] text-white"
                      : "border-[#d3dbe5] text-[#334155]"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="repeatWeekdays"
                    value={weekday.value}
                    checked={selectedWeekdays.has(weekday.value)}
                    onChange={(event) => toggleWeekday(weekday.value, event.target.checked)}
                    className="sr-only"
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
