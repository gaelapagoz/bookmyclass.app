"use client";

type AvailabilityDay = {
  availableSlots: number;
  date: string;
  hasAvailability: boolean;
  totalSlots: number;
};

type AvailabilityCalendarProps = {
  days: AvailabilityDay[];
  monthKey: string;
  onNextMonth: () => void;
  onPreviousMonth: () => void;
  onSelectDate: (date: string) => void;
  selectedDate: string | null;
  todayDateKey: string;
};

function getMonthLabel(monthKey: string): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const date = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, 1, 12, 0, 0));

  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function buildCalendarDays(monthKey: string): string[] {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const result: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    result.push(`${yearRaw}-${monthRaw}-${String(day).padStart(2, "0")}`);
  }

  return result;
}

function getLeadingEmptyCells(monthKey: string): number {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const firstDay = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, 1, 12, 0, 0)).getUTCDay();

  return firstDay === 0 ? 6 : firstDay - 1;
}

export function AvailabilityCalendar({
  monthKey,
  days,
  selectedDate,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  todayDateKey,
}: AvailabilityCalendarProps) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const calendarDays = buildCalendarDays(monthKey);
  const leadingEmptyCells = getLeadingEmptyCells(monthKey);

  return (
    <section className="rounded-xl border border-[#d8cec6] bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onPreviousMonth}
          className="rounded-md border border-[#d8cec6] px-3 py-1 text-sm text-[#6f2b2b] hover:bg-[#f2ede7]"
          aria-label="Show previous month"
        >
          Prev
        </button>
        <h2 className="text-lg font-semibold text-[#6f2b2b]">{getMonthLabel(monthKey)}</h2>
        <button
          type="button"
          onClick={onNextMonth}
          className="rounded-md border border-[#d8cec6] px-3 py-1 text-sm text-[#6f2b2b] hover:bg-[#f2ede7]"
          aria-label="Show next month"
        >
          Next
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold tracking-wide text-[#8a5959]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: leadingEmptyCells }).map((_, index) => (
          <span key={`empty-${index}`} className="h-10 rounded-md bg-transparent" />
        ))}

        {calendarDays.map((date) => {
          const day = byDate.get(date);
          const isPast = date < todayDateKey;
          const isSelected = selectedDate === date;
          const isDisabled = isPast;
          const hasSessions = Boolean(day);

          return (
            <button
              key={date}
              type="button"
              disabled={isDisabled}
              aria-label={`Select ${date}`}
              onClick={() => onSelectDate(date)}
              className={`h-10 rounded-md border text-sm transition ${
                isSelected
                  ? "border-[#7b2d2d] bg-[#7b2d2d] text-[#f4eee8]"
                  : hasSessions
                    ? day?.hasAvailability
                      ? "border-[#d8cec6] bg-[#f2ede7] text-[#6f2b2b] hover:border-[#7b2d2d]"
                      : "border-[#d8cec6] bg-[#faf7f3] text-[#8a5959] hover:border-[#b68585]"
                    : "border-[#eee8e1] bg-white text-[#c4b5a8]"
              } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              {date.slice(8, 10)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
