import { describe, expect, it } from "vitest";

import { isStaffRole } from "../../src/lib/auth/admin-access";

describe("staff-entry permission helper", () => {
  it("returns true for staff roles", () => {
    expect(isStaffRole("ADMIN")).toBe(true);
    expect(isStaffRole("MASTER_ADMIN")).toBe(true);
    expect(isStaffRole("TEACHER")).toBe(true);
  });

  it("returns false for non-staff roles", () => {
    expect(isStaffRole("CLIENT")).toBe(false);
    expect(isStaffRole(undefined)).toBe(false);
  });
});

