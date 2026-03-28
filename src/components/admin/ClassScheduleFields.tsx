"use client";

import { useMemo, useState } from "react";

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
    repeatEveryWeeks?: number;
    weekdays?: Weekday[];
    endsType?: "never" | "onDate" | "afterOccurrences";
    endDate?: string | null;
    occurrenceCount?: number | null;
  };
};

export default function ClassScheduleFields({ teachers, defaultValues }: Props) {
  const [isRecurring, setIsRecurring] = useState(Boolean(defaultValues?.isRecurring));
  const [endsType, setEndsType] = useState<"never" | "onDate" | "afterOccurrences">(
    defaultValues?.endsType ?? "never",
  );
  const selectedWeekdays = useMemo(
    () => new Set(defaultValues?.weekdays ?? []),
    [defaultValues?.weekdays],
  );

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

      <div className="mt-4 grid gap-3 md:grid-cols-3">
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
        <div className="mt-3 grid gap-3 md:max-w-xs">
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
        <div className="mt-4 space-y-4 rounded-lg border border-[#e2e8f0] p-4">
          <div className="grid items-end gap-3 md:grid-cols-[auto_110px_auto]">
            <p className="text-sm text-[#334155]">Repeat every</p>
            <input
              name="repeatEveryWeeks"
              type="number"
              min={1}
              max={12}
              required={isRecurring}
              defaultValue={defaultValues?.repeatEveryWeeks ?? 1}
              className="w-full rounded-md border border-[#d3dbe5] px-3 py-2 text-sm"
            />
            <span className="text-sm text-[#334155]">week(s)</span>
          </div>

          <fieldset>
            <legend className="text-sm text-[#334155]">Repeat on</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {weekdayItems.map((weekday) => (
                <label
                  key={weekday.value}
                  className="inline-flex cursor-pointer items-center rounded-full border border-[#d3dbe5] px-3 py-1.5 text-xs text-[#334155]"
                >
                  <input
                    type="checkbox"
                    name="repeatWeekdays"
                    value={weekday.value}
                    defaultChecked={selectedWeekdays.has(weekday.value)}
                    className="sr-only"
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm text-[#334155]">Ends</legend>
            <div className="flex flex-wrap gap-4 text-sm text-[#334155]">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="endsType"
                  value="never"
                  checked={endsType === "never"}
                  onChange={() => setEndsType("never")}
                />
                Never
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="endsType"
                  value="onDate"
                  checked={endsType === "onDate"}
                  onChange={() => setEndsType("onDate")}
                />
                On
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="endsType"
                  value="afterOccurrences"
                  checked={endsType === "afterOccurrences"}
                  onChange={() => setEndsType("afterOccurrences")}
                />
                After
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block text-sm text-[#334155]">
                End Date
                <input
                  name="endDate"
                  type="date"
                  required={isRecurring && endsType === "onDate"}
                  defaultValue={defaultValues?.endDate ?? ""}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
              <label className="block text-sm text-[#334155]">
                Occurrences
                <input
                  name="occurrenceCount"
                  type="number"
                  min={1}
                  max={260}
                  required={isRecurring && endsType === "afterOccurrences"}
                  defaultValue={defaultValues?.occurrenceCount ?? ""}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                />
              </label>
            </div>
          </fieldset>
        </div>
      )}
    </section>
  );
}
