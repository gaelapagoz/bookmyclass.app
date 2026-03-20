export const STUDIO_TIMEZONE = "Europe/Brussels";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: STUDIO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: STUDIO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: STUDIO_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type DateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

function toParts(formatter: Intl.DateTimeFormat, date: Date): DateParts {
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

function getTimeZoneOffsetMs(utcDate: Date): number {
  const localParts = toParts(dateTimeFormatter, utcDate);
  const asUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );

  return asUtc - utcDate.getTime();
}

function zonedDateTimeToUtcDate(params: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second?: number;
  year: number;
}): Date {
  const { year, month, day, hour, minute, second = 0 } = params;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstGuess = new Date(naiveUtc);
  const firstOffset = getTimeZoneOffsetMs(firstGuess);
  const adjustedTime = naiveUtc - firstOffset;
  const secondGuess = new Date(adjustedTime);
  const secondOffset = getTimeZoneOffsetMs(secondGuess);

  if (secondOffset !== firstOffset) {
    return new Date(naiveUtc - secondOffset);
  }

  return secondGuess;
}

export function getStudioDateKey(date: Date): string {
  return dateFormatter.format(date);
}

export function getStudioMonthKey(date: Date): string {
  return getStudioDateKey(date).slice(0, 7);
}

export function getStudioTimeLabel(date: Date): string {
  return timeFormatter.format(date);
}

export function getMonthRangeUtc(monthKey: string): { fromUtc: Date; toUtc: Date } {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;

  const fromUtc = zonedDateTimeToUtcDate({
    year,
    month,
    day: 1,
    hour: 0,
    minute: 0,
  });
  const toUtc = zonedDateTimeToUtcDate({
    year: nextMonthYear,
    month: nextMonth,
    day: 1,
    hour: 0,
    minute: 0,
  });

  return { fromUtc, toUtc };
}

export function getDateRangeUtc(dateKey: string): { fromUtc: Date; toUtc: Date } {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const fromUtc = zonedDateTimeToUtcDate({
    year,
    month,
    day,
    hour: 0,
    minute: 0,
  });
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + 1);
  const toUtc = zonedDateTimeToUtcDate({
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
    hour: 0,
    minute: 0,
  });

  return { fromUtc, toUtc };
}

export function addMonths(monthKey: string, delta: number): string {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  const date = new Date(Date.UTC(year, monthIndex + delta, 1, 12, 0, 0));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function isValidMonthKey(value: string | null): value is string {
  if (!value) {
    return false;
  }

  if (!/^\d{4}-\d{2}$/.test(value)) {
    return false;
  }

  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

export function isValidDateKey(value: string | null): value is string {
  if (!value) {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() + 1 === month &&
    candidate.getUTCDate() === day
  );
}
