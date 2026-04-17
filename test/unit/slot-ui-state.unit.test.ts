import { describe, expect, it } from "vitest";
import { getFullSlotMessage, getSlotUiState } from "@/components/book-a-class/service-detail/slot-ui-state";

describe("slot ui state helpers", () => {
  it("maps slot state for available, waitlist joinable, and full unavailable slots", () => {
    expect(
      getSlotUiState({
        isAvailable: true,
        isWaitlistAvailable: false,
        isWaitlistSupported: true,
      }),
    ).toBe("BOOKABLE");

    expect(
      getSlotUiState({
        isAvailable: false,
        isWaitlistAvailable: true,
        isWaitlistSupported: true,
      }),
    ).toBe("WAITLIST_JOINABLE");

    expect(
      getSlotUiState({
        isAvailable: false,
        isWaitlistAvailable: false,
        isWaitlistSupported: true,
      }),
    ).toBe("FULL_WAITLIST_UNAVAILABLE");
  });

  it("returns full-slot messaging without exposing waitlist position", () => {
    expect(getFullSlotMessage({ isWaitlistSupported: true })).toContain("Waitlist is currently full");
    expect(getFullSlotMessage({ isWaitlistSupported: false })).toContain("Waitlist is unavailable");
    expect(getFullSlotMessage({ isWaitlistSupported: true }).toLowerCase()).not.toContain("position");
  });
});
