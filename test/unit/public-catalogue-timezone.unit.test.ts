import { describe, expect, it } from "vitest";
import { addMonths, isValidDateKey, isValidMonthKey } from "../../src/lib/public-catalogue/timezone";

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
});
