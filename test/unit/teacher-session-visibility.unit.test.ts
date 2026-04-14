import { describe, expect, it } from "vitest";

import { assertTeacherSessionScope } from "../../src/lib/teacher/teacher-helpers";

describe("teacher session visibility helper", () => {
  it("allows assigned teacher session scope", () => {
    expect(() =>
      assertTeacherSessionScope({
        teacherUserId: "teacher-1",
        sessionTeacherId: "teacher-1",
      }),
    ).not.toThrow();
  });

  it("blocks unassigned teacher session scope", () => {
    expect(() =>
      assertTeacherSessionScope({
        teacherUserId: "teacher-1",
        sessionTeacherId: "teacher-2",
      }),
    ).toThrow("TEACHER_SESSION_FORBIDDEN");
  });
});

