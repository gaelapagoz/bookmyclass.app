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

const { mkdirMock, unlinkMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  unlinkMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: mkdirMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));

vi.mock("@/lib/security/same-origin", () => ({
  assertSameOriginServerAction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: vi.fn(),
}));

vi.mock("@/lib/teacher/teacher-service", () => ({
  updateTeacherSelfProfile: vi.fn(),
  updateTeacherSelfImage: vi.fn(),
  addTeacherSessionAttendee: vi.fn(),
  removeTeacherSessionAttendee: vi.fn(),
}));

vi.mock("@/lib/auth/password-service", () => ({
  changeAuthenticatedUserPassword: vi.fn(),
}));

import { requireTeacherSession } from "@/lib/auth/require-auth";
import { changeAuthenticatedUserPassword } from "@/lib/auth/password-service";
import { addTeacherSessionAttendee, updateTeacherSelfImage } from "@/lib/teacher/teacher-service";
import {
  addTeacherSessionAttendeeAction,
  changeTeacherPasswordAction,
  uploadTeacherSelfImageAction,
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

function createPngFile(name = "teacher.png") {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: "image/png",
  });
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

  it("uploads own teacher image through the shared media helper", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);
    vi.mocked(updateTeacherSelfImage).mockResolvedValue({
      id: "teacher-1",
      image: "/images/instructors/teacher-teacher-1-test.png",
    });

    const formData = new FormData();
    formData.set("teacherImage", createPngFile());

    await expect(uploadTeacherSelfImageAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/profile?success=Teacher%20picture%20updated.",
    );

    expect(mkdirMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(updateTeacherSelfImage).toHaveBeenCalledWith({
      teacherUserId: "teacher-1",
      requestedTeacherUserId: "teacher-1",
      imagePath: expect.stringMatching(/^\/images\/instructors\/teacher-teacher-1-/),
    });
  });

  it("rejects spoofed own teacher image uploads before persistence", async () => {
    vi.mocked(requireTeacherSession).mockResolvedValue(teacherSession() as never);

    const formData = new FormData();
    formData.set("teacherImage", new File(["not-a-png"], "teacher.png", { type: "image/png" }));

    await expect(uploadTeacherSelfImageAction(formData)).rejects.toThrow(
      "NEXT_REDIRECT:/teacher/profile?error=Only%20valid%20JPG%2C%20PNG%2C%20or%20WEBP%20images%20are%20accepted.",
    );

    expect(updateTeacherSelfImage).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});
