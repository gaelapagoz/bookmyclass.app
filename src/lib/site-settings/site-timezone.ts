export const DEFAULT_SITE_TIME_ZONE = "Europe/Brussels";

export type SiteTimeZoneOption = {
  label: string;
  value: string;
};

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

function getTimeZoneOffsetMinutes(timeZone: string, referenceDate: Date): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const localParts = toParts(formatter, referenceDate);
  const asUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );

  return Math.round((asUtc - referenceDate.getTime()) / 60000);
}

function formatUtcOffset(timeZone: string, referenceDate: Date): string {
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, referenceDate);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;

  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTimeZoneCityLabel(timeZone: string): string {
  const city = timeZone.split("/").at(-1) ?? timeZone;
  return city.replaceAll("_", " ");
}

export function getSupportedIanaTimeZones(): string[] {
  return Intl.supportedValuesOf("timeZone").filter(isValidIanaTimeZone);
}

export function formatTimeZoneOptionLabel(timeZone: string, referenceDate: Date = new Date()): string {
  return `(${formatUtcOffset(timeZone, referenceDate)}) ${formatTimeZoneCityLabel(timeZone)}`;
}

export function getSiteTimeZoneOptions(referenceDate: Date = new Date()): SiteTimeZoneOption[] {
  return getSupportedIanaTimeZones()
    .map((timeZone) => ({
      value: timeZone,
      label: formatTimeZoneOptionLabel(timeZone, referenceDate),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, "en"));
}

export function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date("2026-01-01T00:00:00.000Z"));
    return true;
  } catch {
    return false;
  }
}

export function normalizeSiteTimeZone(value: string): string {
  const normalized = value.trim();
  if (!normalized || !isValidIanaTimeZone(normalized)) {
    throw new Error("INVALID_SITE_TIME_ZONE");
  }
  return normalized;
}
