/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireTeacherSessionMock = vi.fn();
const getTeacherAssignedSessionsMock = vi.fn();
const getTeacherSelfProfileMock = vi.fn();
const getTeacherSessionRosterDataMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: (...args: unknown[]) => requireTeacherSessionMock(...args),
}));

vi.mock("@/lib/teacher/teacher-service", () => ({
  getTeacherAssignedSessions: (...args: unknown[]) => getTeacherAssignedSessionsMock(...args),
  getTeacherSelfProfile: (...args: unknown[]) => getTeacherSelfProfileMock(...args),
  getTeacherSessionRosterData: (...args: unknown[]) => getTeacherSessionRosterDataMock(...args),
}));

vi.mock("@/app/teacher/actions", () => ({
  updateTeacherProfileAction: vi.fn(),
  addTeacherSessionAttendeeAction: vi.fn(),
  removeTeacherSessionAttendeeAction: vi.fn(),
  updateTeacherSessionAttendanceAction: vi.fn(),
  changeTeacherPasswordAction: vi.fn(),
}));

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    redirect: (...args: unknown[]) => redirectMock(...args),
  };
});

import TeacherSessionsPage from "../../src/app/teacher/sessions/page";
import TeacherProfilePage from "../../src/app/teacher/profile/page";
import TeacherSessionRosterPage from "../../src/app/teacher/sessions/[id]/page";

describe("teacher pages", () => {
  beforeEach(() => {
    requireTeacherSessionMock.mockReset();
    getTeacherAssignedSessionsMock.mockReset();
    getTeacherSelfProfileMock.mockReset();
    getTeacherSessionRosterDataMock.mockReset();
    redirectMock.mockReset();

    requireTeacherSessionMock.mockResolvedValue({
      user: { id: "teacher-1", role: "TEACHER" },
    });
  });

  it("renders assigned sessions in calendar view", async () => {
    getTeacherAssignedSessionsMock.mockResolvedValue([
      {
        id: "session-1",
        title: "Teacher Session",
        className: "Pilates",
        teacherName: "Ana",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        capacity: 12,
        bookedCount: 3,
        waitlistCount: 1,
        status: "SCHEDULED",
        isPublished: true,
        location: null,
      },
    ]);

    render(await TeacherSessionsPage());

    expect(screen.getByRole("heading", { name: "My Sessions" })).toBeInTheDocument();
    // Calendar renders: "Time" header, day headers, and hour labels
    expect(screen.getByText("Time")).toBeInTheDocument();
    // Check that calendar structure is present
    expect(screen.getByText("Previous week")).toBeInTheDocument();
  });

  it("renders teacher profile self-edit view with profile and password sections", async () => {
    getTeacherSelfProfileMock.mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Coach",
      fullName: "Ana Coach",
      email: "teacher@example.test",
      image: "",
      phone: "+32000000000",
      bio: "Pilates coach",
      specialties: ["Pilates"],
      certifications: ["L1"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "My Teacher Profile" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("teacher@example.test")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Profile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
  });

  it("renders roster and add/remove client controls for assigned session", async () => {
    getTeacherSessionRosterDataMock.mockResolvedValue({
      session: {
        id: "session-1",
        title: "Teacher Session",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        attendees: [
          {
            bookingId: "booking-1",
            clientName: "Client One",
            clientEmail: "client.one@example.test",
            status: "CONFIRMED",
            attendanceStatus: "CHECKED_IN",
            attendanceSource: "DASHBOARD",
            checkedInAt: new Date().toISOString(),
          },
        ],
      },
      clients: [
        {
          id: "client-1",
          name: "Client One",
          email: "client.one@example.test",
          availableCredits: 2,
          hasAvailableCredits: true,
          hasEligibleAccess: true,
          eligibilityLabel: "2 credits available",
        },
      ],
    });

    render(
      await TeacherSessionRosterPage({
        params: Promise.resolve({ id: "session-1" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByTestId("teacher-session-roster")).toBeInTheDocument();
    expect(screen.getByText("Client One")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add client" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove client" })).toBeInTheDocument();
    expect(screen.getByText(/Attendance: CHECKED_IN/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark attended" })).toBeInTheDocument();
  });

  it("redirects roster access when session is not found", async () => {
    getTeacherSessionRosterDataMock.mockResolvedValue(null);

    await TeacherSessionRosterPage({
      params: Promise.resolve({ id: "missing-session" }),
      searchParams: Promise.resolve({}),
    });

    expect(redirectMock).toHaveBeenCalled();
  });

  it("renders calendar view for teacher sessions with week navigation", async () => {
    getTeacherAssignedSessionsMock.mockResolvedValue([
      {
        id: "session-1",
        title: "Morning Yoga",
        className: "Vinyasa",
        teacherName: "Ana",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        capacity: 20,
        bookedCount: 15,
        waitlistCount: 0,
        status: "SCHEDULED",
        isPublished: true,
        location: "Studio A",
      },
    ]);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    // Calendar structure is present
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Previous week")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Next week")).toBeInTheDocument();
    // Week header is displayed
    expect(screen.getByText(/Week of/)).toBeInTheDocument();
  });

  it("renders password change form in teacher profile", async () => {
    getTeacherSelfProfileMock.mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Coach",
      fullName: "Ana Coach",
      email: "teacher@example.test",
      image: "",
      phone: "+32000000000",
      bio: "Pilates coach",
      specialties: ["Pilates"],
      certifications: ["L1"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "Profile Information" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Change Password" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update Password" })).toBeInTheDocument();
  });

  it("displays password success message when password_success param is present", async () => {
    getTeacherSelfProfileMock.mockResolvedValue({
      id: "teacher-1",
      firstName: "Ana",
      lastName: "Coach",
      fullName: "Ana Coach",
      email: "teacher@example.test",
      image: "",
      phone: "+32000000000",
      bio: "Pilates coach",
      specialties: ["Pilates"],
      certifications: ["L1"],
    });

    render(
      await TeacherProfilePage({
        searchParams: Promise.resolve({
          password_success: "Password updated successfully.",
        }),
      }),
    );

    expect(screen.getByText("Password updated successfully.")).toBeInTheDocument();
  });
});
