export const DEFAULT_SITE_TIME_ZONE = "Europe/Brussels";

export const SITE_TIME_ZONE_OPTIONS = [
  "Europe/Brussels",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
] as const;

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
