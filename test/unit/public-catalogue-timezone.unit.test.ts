import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatDateTimeLocalInTimeZone,
  getDateRangeUtc,
  getSiteDateKey,
  getSiteTimeLabel,
  isValidDateKey,
  isValidMonthKey,
  parseDateTimeLocalInTimeZone,
} from "../../src/lib/public-catalogue/timezone";
import {
  formatTimeZoneOptionLabel,
  getSiteTimeZoneOptions,
  isValidIanaTimeZone,
  normalizeSiteTimeZone,
} from "../../src/lib/site-settings/site-timezone";

describe("public catalogue timezone helpers", () => {
  it("validates month and date keys", () => {
    expect(isValidMonthKey("2026-04")).toBe(true);
    expect(isValidMonthKey("2026-13")).toBe(false);

    expect(isValidDateKey("2026-04-12")).toBe(true);
    expect(isValidDateKey("2026-02-31")).toBe(false);
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("validates IANA site timezones", () => {
    expect(isValidIanaTimeZone("Europe/Brussels")).toBe(true);
    expect(isValidIanaTimeZone("America/New_York")).toBe(true);
    expect(() => normalizeSiteTimeZone("Not/AZone")).toThrow("INVALID_SITE_TIME_ZONE");
  });

  it("formats timezone option labels with UTC offset and city", () => {
    const referenceDate = new Date("2026-04-15T12:00:00.000Z");

    expect(formatTimeZoneOptionLabel("Europe/Brussels", referenceDate)).toBe("(UTC+02:00) Brussels");
    expect(formatTimeZoneOptionLabel("America/New_York", referenceDate)).toBe("(UTC-04:00) New York");
  });

  it("lists runtime-supported IANA timezone options with canonical stored values", () => {
    const options = getSiteTimeZoneOptions(new Date("2026-04-15T12:00:00.000Z"));
    const brussels = options.find((option) => option.value === "Europe/Brussels");
    const newYork = options.find((option) => option.value === "America/New_York");

    expect(options.length).toBeGreaterThan(100);
    expect(brussels).toEqual({ value: "Europe/Brussels", label: "(UTC+02:00) Brussels" });
    expect(newYork).toEqual({ value: "America/New_York", label: "(UTC-04:00) New York" });
  });

  it("uses Brussels DST when converting local date boundaries", () => {
    const range = getDateRangeUtc("2026-03-29", "Europe/Brussels");

    expect(range.fromUtc.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(range.toUtc.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("uses configured timezone for date keys around midnight", () => {
    const instant = new Date("2026-04-15T22:30:00.000Z");

    expect(getSiteDateKey(instant, "Europe/Brussels")).toBe("2026-04-16");
    expect(getSiteDateKey(instant, "America/New_York")).toBe("2026-04-15");
    expect(getSiteTimeLabel(instant, "America/New_York")).toBe("18:30");
  });

  it("formats datetime-local values in the configured site timezone across DST boundaries", () => {
    expect(
      formatDateTimeLocalInTimeZone(new Date("2026-03-29T01:30:00.000Z"), "Europe/Brussels"),
    ).toBe("2026-03-29T03:30");
    expect(
      formatDateTimeLocalInTimeZone(new Date("2026-10-25T08:30:00.000Z"), "Europe/Brussels"),
    ).toBe("2026-10-25T09:30");
  });

  it("parses datetime-local values back to UTC using the configured site timezone", () => {
    expect(
      parseDateTimeLocalInTimeZone("2026-03-29T03:30", "Europe/Brussels")?.toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
    expect(
      parseDateTimeLocalInTimeZone("2026-10-25T09:30", "Europe/Brussels")?.toISOString(),
    ).toBe("2026-10-25T08:30:00.000Z");
  });

  it("rejects impossible datetime-local values in the configured site timezone", () => {
    expect(parseDateTimeLocalInTimeZone("2026-03-29T02:30", "Europe/Brussels")).toBeNull();
  });
});
