/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireTeacherSession: vi.fn(async () => ({
    user: {
      id: "teacher-1",
      role: "TEACHER",
    },
  })),
}));

vi.mock("@/lib/teacher/teacher-service", () => ({
  getTeacherAssignedSessions: vi.fn(),
}));

import { getTeacherAssignedSessions } from "@/lib/teacher/teacher-service";
import TeacherSessionsPage from "../../src/app/teacher/sessions/page";

describe("teacher sessions calendar page", () => {
  it("renders calendar view with week navigation", async () => {
    vi.mocked(getTeacherAssignedSessions).mockResolvedValue([]);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByRole("heading", { name: "My Sessions" })).toBeInTheDocument();
    expect(
      screen.getByText("Only sessions assigned to you are visible here."),
    ).toBeInTheDocument();
    expect(screen.getByText("Previous week")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Next week")).toBeInTheDocument();
  });

  it("displays empty state when no sessions are assigned", async () => {
    vi.mocked(getTeacherAssignedSessions).mockResolvedValue([]);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(
      screen.getByText("No sessions assigned to you for this week."),
    ).toBeInTheDocument();
  });

  it("renders calendar grid when sessions are assigned", async () => {
    // Create a session for Monday, April 14, 2026 (within the displayed week)
    const sessionDate = new Date("2026-04-14T06:00:00Z"); // Monday morning
    const mockSessions = [
      {
        id: "session-1",
        title: "Morning Yoga",
        className: "Vinyasa Yoga",
        teacherName: "Ana Ionescu",
        startsAt: sessionDate.toISOString(),
        endsAt: new Date(sessionDate.getTime() + 3600000).toISOString(), // 1 hour later
        capacity: 20,
        bookedCount: 15,
        waitlistCount: 3,
        status: "SCHEDULED" as const,
        isPublished: true,
        location: "Studio A",
      },
    ];

    vi.mocked(getTeacherAssignedSessions).mockResolvedValue(mockSessions);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.getByText("Vinyasa Yoga - Morning Yoga")).toBeInTheDocument();
    expect(screen.getByText(/15\/20 booked/)).toBeInTheDocument();
    expect(screen.getByText("Waitlist: 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join waitlist/i })).not.toBeInTheDocument();
  });

  it("hides waitlist count label when count is zero", async () => {
    vi.mocked(getTeacherAssignedSessions).mockResolvedValue([
      {
        id: "session-2",
        title: "Evening Flow",
        className: "Yoga",
        teacherName: "Ana Ionescu",
        startsAt: new Date("2026-04-15T17:00:00.000Z").toISOString(),
        endsAt: new Date("2026-04-15T18:00:00.000Z").toISOString(),
        capacity: 16,
        bookedCount: 8,
        waitlistCount: 0,
        status: "SCHEDULED" as const,
        isPublished: true,
        location: "Studio B",
      },
    ]);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(screen.queryByText("Waitlist: 0")).not.toBeInTheDocument();
  });

  it("calls getTeacherAssignedSessions with correct parameters", async () => {
    vi.mocked(getTeacherAssignedSessions).mockResolvedValue([]);

    render(
      await TeacherSessionsPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(vi.mocked(getTeacherAssignedSessions)).toHaveBeenCalled();
    const call = vi.mocked(getTeacherAssignedSessions).mock.calls[0]?.[0];
    expect(call?.weekStart).toBeDefined();
    expect(call?.weekEnd).toBeDefined();
    expect(call?.teacherUserId).toBeDefined();
  });
});
