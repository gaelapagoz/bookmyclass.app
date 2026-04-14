import { describe, expect, it } from "vitest";

import { isTeacherRole } from "../../src/lib/teacher/teacher-helpers";

describe("teacher permission helpers", () => {
  it("accepts only TEACHER role", () => {
    expect(isTeacherRole("TEACHER")).toBe(true);
    expect(isTeacherRole("CLIENT")).toBe(false);
    expect(isTeacherRole("ADMIN")).toBe(false);
    expect(isTeacherRole("MASTER_ADMIN")).toBe(false);
    expect(isTeacherRole(undefined)).toBe(false);
  });
});

