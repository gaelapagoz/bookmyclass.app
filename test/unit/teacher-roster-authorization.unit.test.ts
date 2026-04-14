import { describe, expect, it } from "vitest";

import { canTeacherManageSession } from "../../src/lib/teacher/teacher-helpers";

describe("teacher roster authorization helper", () => {
  it("returns true when roster session is assigned to teacher", () => {
    expect(
      canTeacherManageSession({
        teacherUserId: "teacher-1",
        sessionTeacherId: "teacher-1",
      }),
    ).toBe(true);
  });

  it("returns false when roster session is not assigned to teacher", () => {
    expect(
      canTeacherManageSession({
        teacherUserId: "teacher-1",
        sessionTeacherId: "teacher-2",
      }),
    ).toBe(false);
  });
});

