import { describe, expect, it } from "vitest";

import { getSessionWaitlistLabel } from "../../src/components/shared/session-waitlist-label";

describe("session waitlist label helper", () => {
  it("returns null for zero or negative counts", () => {
    expect(getSessionWaitlistLabel(0)).toBeNull();
    expect(getSessionWaitlistLabel(-1)).toBeNull();
  });

  it("returns a compact label for positive counts", () => {
    expect(getSessionWaitlistLabel(1)).toBe("Waitlist: 1");
    expect(getSessionWaitlistLabel(4)).toBe("Waitlist: 4");
  });
});
