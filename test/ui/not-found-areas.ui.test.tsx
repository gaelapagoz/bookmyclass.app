/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireUserSession: vi.fn(async () => ({
    user: {
      id: "teacher-user",
      role: "TEACHER",
    },
  })),
  requireTeacherSession: vi.fn(async () => ({
    user: {
      id: "teacher-user",
      role: "TEACHER",
    },
  })),
}));

vi.mock("@/components/Navbar", () => ({
  default: () => <div data-testid="public-navbar">Public Navbar</div>,
}));

vi.mock("@/components/Footer", () => ({
  default: () => <div data-testid="public-footer">Public Footer</div>,
}));

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    usePathname: vi.fn(() => "/admin/unknown"),
    notFound: notFoundMock,
  };
});

import PublicNotFoundPage from "../../src/app/not-found";
import AdminNotFoundPage from "../../src/app/admin/not-found";
import TeacherNotFoundPage from "../../src/app/teacher/not-found";
import TeacherLayout from "../../src/app/teacher/layout";
import AdminCatchAllPage from "../../src/app/admin/(private)/[...not_found]/page";
import TeacherCatchAllPage from "../../src/app/teacher/[...not_found]/page";

describe("route-area not-found handling", () => {
  it("public not-found renders public shell", async () => {
    render(<PublicNotFoundPage />);

    expect(screen.getByTestId("public-navbar")).toBeInTheDocument();
    expect(screen.getByTestId("public-footer")).toBeInTheDocument();
    expect(screen.getByText("404 - Page Not Found")).toBeInTheDocument();
  });

  it("admin not-found renders admin-specific content and no public shell", async () => {
    render(<AdminNotFoundPage />);

    expect(screen.getByText("Admin page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByTestId("public-navbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).not.toBeInTheDocument();
  });

  it("teacher not-found renders inside teacher shell and no public shell", async () => {
    render(
      await TeacherLayout({
        children: <TeacherNotFoundPage />,
      }),
    );

    expect(screen.getByText("Teacher page not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
    expect(screen.queryByTestId("public-navbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("public-footer")).not.toBeInTheDocument();
  });

  it("admin catch-all route triggers segment notFound", () => {
    expect(() => AdminCatchAllPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("teacher catch-all route triggers segment notFound", () => {
    expect(() => TeacherCatchAllPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });
});
