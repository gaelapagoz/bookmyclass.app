"use client";

import { useState } from "react";

const weekdays = [
  { value: "MONDAY", label: "Mon" },
  { value: "TUESDAY", label: "Tue" },
  { value: "WEDNESDAY", label: "Wed" },
  { value: "THURSDAY", label: "Thu" },
  { value: "FRIDAY", label: "Fri" },
  { value: "SATURDAY", label: "Sat" },
  { value: "SUNDAY", label: "Sun" },
] as const;

export default function SessionScheduleModeFields() {
  const [scheduleMode, setScheduleMode] = useState<"one_off" | "recurring">("one_off");
  const [recurrenceEndMode, setRecurrenceEndMode] = useState<"never" | "on_date" | "after_occurrences">("never");

  const recurringEnabled = scheduleMode === "recurring";

  return (
    <section className="space-y-3 rounded-lg border border-[#e2e8f0] p-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#5a6d86]">Schedule</h2>

      <div className="flex flex-wrap gap-4 text-sm text-[#334155]">
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="scheduleMode"
            value="one_off"
            checked={scheduleMode === "one_off"}
            onChange={() => setScheduleMode("one_off")}
          />
          One-off
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name="scheduleMode"
            value="recurring"
            checked={scheduleMode === "recurring"}
            onChange={() => setScheduleMode("recurring")}
          />
          Recurring
        </label>
      </div>

      {!recurringEnabled ? (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Starts At
            <input
              name="startsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Ends At
            <input
              name="endsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Capacity
            <input
              name="capacity"
              type="number"
              min={1}
              defaultValue={10}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm text-[#334155]">
              Starts On
              <input
                name="recurringStartsOn"
                type="date"
                required={recurringEnabled}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Start Time
              <input
                name="recurringStartTime"
                type="time"
                required={recurringEnabled}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              End Time
              <input
                name="recurringEndTime"
                type="time"
                required={recurringEnabled}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Repeat Every N Week(s)
              <input
                name="recurrenceEveryWeeks"
                type="number"
                min={1}
                max={12}
                defaultValue={1}
                required={recurringEnabled}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm text-[#334155]">Weekdays</legend>
            <div className="flex flex-wrap gap-3 text-sm text-[#334155]">
              {weekdays.map((weekday) => (
                <label key={weekday.value} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="recurringWeekdays"
                    value={weekday.value}
                    defaultChecked={weekday.value === "MONDAY"}
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm text-[#334155]">
              End
              <select
                name="recurrenceEndMode"
                value={recurrenceEndMode}
                onChange={(event) =>
                  setRecurrenceEndMode(event.target.value as "never" | "on_date" | "after_occurrences")
                }
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              >
                <option value="never">Never (beta creates 1 year of sessions)</option>
                <option value="on_date">On date</option>
                <option value="after_occurrences">After N occurrences</option>
              </select>
            </label>
            <label className="block text-sm text-[#334155]">
              End Date
              <input
                name="recurrenceEndDate"
                type="date"
                required={recurrenceEndMode === "on_date"}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
            <label className="block text-sm text-[#334155]">
              Occurrences
              <input
                name="recurrenceOccurrences"
                type="number"
                min={1}
                max={260}
                required={recurrenceEndMode === "after_occurrences"}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>
          </div>

          <label className="block text-sm text-[#334155]">
            Capacity
            <input
              name="capacity"
              type="number"
              min={1}
              defaultValue={10}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>
      )}
    </section>
  );
}
