/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireTeacherSessionMock, signOutMock } = vi.hoisted(() => ({
  requireTeacherSessionMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: (...args: unknown[]) => requireTeacherSessionMock(...args),
}));

vi.mock("@/auth", () => ({
  signOut: signOutMock,
}));

import TeacherLayout from "../../src/app/teacher/layout";

describe("Teacher layout guard", () => {
  beforeEach(() => {
    requireTeacherSessionMock.mockReset();
    requireTeacherSessionMock.mockResolvedValue({
      user: { id: "teacher-1", role: "TEACHER" },
    });
  });

  it("renders teacher shell for teacher role", async () => {
    render(
      await TeacherLayout({
        children: <div>Teacher content</div>,
      }),
    );

    expect(screen.getByText("Teacher content")).toBeInTheDocument();
  });

  it("renders a logout control in the teacher sidebar", async () => {
    render(
      await TeacherLayout({
        children: <div>Teacher content</div>,
      }),
    );

    expect(screen.getByRole("button", { name: /logout/i })).toBeInTheDocument();
  });

  it("redirects non-teacher/admin users", async () => {
    requireTeacherSessionMock.mockRejectedValue(new Error("FORBIDDEN"));

    await expect(
      TeacherLayout({
        children: <div>Hidden content</div>,
      }),
    ).rejects.toThrow("FORBIDDEN");
  });
});
