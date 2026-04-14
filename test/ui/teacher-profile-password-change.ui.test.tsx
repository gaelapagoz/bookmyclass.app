/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
  };
});

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: vi.fn(async () => ({
    user: {
      id: "teacher-1",
      role: "TEACHER",
    },
  })),
}));

vi.mock("@/lib/auth/password-service", () => ({
  changeAuthenticatedUserPassword: vi.fn(),
}));

vi.mock("@/lib/teacher/teacher-service", () => ({
  getTeacherSelfProfile: vi.fn(),
}));

import { getTeacherSelfProfile } from "@/lib/teacher/teacher-service";
import TeacherProfilePage from "../../src/app/teacher/profile/page";

describe("teacher profile page", () => {
  it("renders profile form with profile information section", async () => {
    vi.mocked(getTeacherSelfProfile).mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Ionescu",
      fullName: "Ana Ionescu",
      email: "ana.ionescu@example.test",
      image: "",
      phone: "+32000000001",
      bio: "Ana leads yoga classes",
      specialties: ["Yoga"],
      certifications: ["RYT-200"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "My Teacher Profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile Information" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ana")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Ionescu")).toBeInTheDocument();
  });

  it("renders change password form section", async () => {
    vi.mocked(getTeacherSelfProfile).mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Ionescu",
      fullName: "Ana Ionescu",
      email: "ana.ionescu@example.test",
      image: "",
      phone: "+32000000001",
      bio: "Ana leads yoga classes",
      specialties: ["Yoga"],
      certifications: ["RYT-200"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update Password" })).toBeInTheDocument();
  });

  it("displays password success message when password_success param is present", async () => {
    vi.mocked(getTeacherSelfProfile).mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Ionescu",
      fullName: "Ana Ionescu",
      email: "ana.ionescu@example.test",
      image: "",
      phone: "+32000000001",
      bio: "Ana leads yoga classes",
      specialties: ["Yoga"],
      certifications: ["RYT-200"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({
          password_success: "Password updated successfully.",
        }),
      }),
    );

    expect(
      screen.getByText("Password updated successfully."),
    ).toBeInTheDocument();
  });

  it("displays password error message when password_error param is present", async () => {
    vi.mocked(getTeacherSelfProfile).mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Ionescu",
      fullName: "Ana Ionescu",
      email: "ana.ionescu@example.test",
      image: "",
      phone: "+32000000001",
      bio: "Ana leads yoga classes",
      specialties: ["Yoga"],
      certifications: ["RYT-200"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({
          password_error: "Password error: invalid_current",
        }),
      }),
    );

    expect(
      screen.getByText("Password error: invalid_current"),
    ).toBeInTheDocument();
  });
});
