import { describe, expect, it } from "vitest";

import { resolveStaffWorkspacePath } from "../../src/lib/auth/admin-access";

describe("staff-role redirect helper", () => {
  it("routes teacher to /teacher", () => {
    expect(resolveStaffWorkspacePath("TEACHER")).toBe("/teacher");
  });

  it("routes admin roles to /admin/dashboard", () => {
    expect(resolveStaffWorkspacePath("ADMIN")).toBe("/admin/dashboard");
    expect(resolveStaffWorkspacePath("MASTER_ADMIN")).toBe("/admin/dashboard");
  });

  it("returns null for non-staff roles", () => {
    expect(resolveStaffWorkspacePath("CLIENT")).toBeNull();
    expect(resolveStaffWorkspacePath(undefined)).toBeNull();
  });
});

