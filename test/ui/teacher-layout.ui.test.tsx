/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserSessionMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  requireUserSession: (...args: unknown[]) => requireUserSessionMock(...args),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: (...args: unknown[]) => redirectMock(...args),
  };
});

import TeacherLayout from "../../src/app/teacher/layout";

describe("Teacher layout guard", () => {
  beforeEach(() => {
    requireUserSessionMock.mockReset();
    redirectMock.mockReset();
    requireUserSessionMock.mockResolvedValue({
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
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects non-teacher/admin users", async () => {
    requireUserSessionMock.mockResolvedValue({
      user: { id: "client-1", role: "CLIENT" },
    });

    await TeacherLayout({
      children: <div>Hidden content</div>,
    });

    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});
