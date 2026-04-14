import { describe, expect, it } from "vitest";

import { assertTeacherSelfScope } from "../../src/lib/teacher/teacher-helpers";

describe("teacher profile self-scope helper", () => {
  it("allows teacher to edit own profile scope", () => {
    expect(() =>
      assertTeacherSelfScope({
        teacherUserId: "teacher-1",
        requestedTeacherUserId: "teacher-1",
      }),
    ).not.toThrow();
  });

  it("blocks teacher from editing another profile scope", () => {
    expect(() =>
      assertTeacherSelfScope({
        teacherUserId: "teacher-1",
        requestedTeacherUserId: "teacher-2",
      }),
    ).toThrow("TEACHER_SELF_SCOPE_FORBIDDEN");
  });
});

