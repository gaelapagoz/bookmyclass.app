import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: vi.fn(),
}));

vi.mock("@/lib/teacher/teacher-service", () => ({
  updateTeacherSelfProfile: vi.fn(),
  addTeacherSessionAttendee: vi.fn(),
  removeTeacherSessionAttendee: vi.fn(),
}));

vi.mock("@/lib/auth/password-service", () => ({
  changeAuthenticatedUserPassword: vi.fn(),
}));

import { requireTeacherSession } from "@/lib/auth/require-auth";
import { changeAuthenticatedUserPassword } from "@/lib/auth/password-service";
import { addTeacherSessionAttendee } from "@/lib/teacher/teacher-service";
import {
  addTeacherSessionAttendeeAction,
  changeTeacherPasswordAction,
  updateTeacherProfileAction,
} from "../../src/app/teacher/actions";

function teacherSession() {
  return {
    user: {
      id: "teacher-1",
      email: "teacher@example.test",
      role: "TEACHER",
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

describe("teacher actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies unauthenticated teacher profile update", async () => {
    vi.mocked(requireTeacherSession).mockRejectedValue(new Error("UNAUTHENTICATED"));
    await expect(updateTeacherProfileAction(new FormData())).rejects.toThrow("UNAUTHENTICATED");
  });

  it("fails safely on invalid teacher profile payload", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);
    const formData = new FormData();
    formData.set("firstName", "");
    formData.set("lastName", "");

    await expect(updateTeacherProfileAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/profile?error=Please%20complete%20the%20required%20profile%20fields.",
    );
  });

  it("maps forbidden attendee mutation to actionable failure", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);
    vi.mocked(addTeacherSessionAttendee).mockRejectedValue(new Error("TEACHER_SESSION_FORBIDDEN"));
    const formData = new FormData();
    formData.set("clientId", "client-1");

    await expect(addTeacherSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/sessions/session-1?error=You%20can%20manage%20rosters%20only%20for%20your%20own%20sessions.",
    );
  });

  it("maps eligibility requirement error for teacher attendee add", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);
    vi.mocked(addTeacherSessionAttendee).mockRejectedValue(new Error("SESSION_ELIGIBILITY_REQUIRED"));
    const formData = new FormData();
    formData.set("clientId", "client-1");

    await expect(addTeacherSessionAttendeeAction("session-1", formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/sessions/session-1?error=You%20can%20only%20add%20clients%20with%20eligible%20credit%20or%20qualifying%20subscription.",
    );
  });

  it("maps password service validation errors in teacher password flow", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);
    vi.mocked(changeAuthenticatedUserPassword).mockRejectedValue(
      Object.assign(new Error("Invalid current password"), { code: "INVALID_CURRENT_PASSWORD" }),
    );
    const formData = new FormData();
    formData.set("currentPassword", "bad");
    formData.set("newPassword", "Password123!");
    formData.set("confirmPassword", "Password123!");

    await expect(changeTeacherPasswordAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/profile?error=Password%20error%3A%20invalid_current",
    );
  });
});
