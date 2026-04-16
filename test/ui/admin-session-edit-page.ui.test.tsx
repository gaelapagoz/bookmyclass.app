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

vi.mock("next/cache", () => ({
  unstable_noStore: vi.fn(),
}));

vi.mock("@/app/admin/(private)/actions", () => ({
  updateSessionAction: vi.fn(),
  addSessionAttendeeAction: vi.fn(),
  removeSessionAttendeeAction: vi.fn(),
  updateSessionAttendanceAction: vi.fn(),
}));

vi.mock("@/lib/admin/admin-service", () => ({
  getAdminSessionById: vi.fn(),
  getAdminSessionOptions: vi.fn(),
}));

import { getAdminSessionById, getAdminSessionOptions } from "@/lib/admin/admin-service";

import AdminSessionEditPage from "../../src/app/admin/(private)/sessions/[id]/edit/page";

describe("admin session edit page", () => {
  it("renders correct action row order, attendee list, and client credit visibility", async () => {
    vi.mocked(getAdminSessionById).mockResolvedValue({
      id: "session-1",
      classTemplateId: "template-1",
      teacherId: "teacher-1",
      title: "Morning Flow",
      description: "desc",
      location: "Studio",
      startsAt: new Date("2026-06-10T09:00:00.000Z"),
      endsAt: new Date("2026-06-10T10:00:00.000Z"),
      capacity: 12,
      status: "SCHEDULED",
      isPublished: true,
      attendees: [
        {
          bookingId: "booking-1",
          clientId: "client-1",
          clientName: "Client One",
          clientEmail: "client1@example.test",
          bookedAt: new Date().toISOString(),
          status: "CONFIRMED",
          selectedEntitlementId: "ent-1",
          attendanceStatus: "CHECKED_IN",
          attendanceSource: "KIOSK",
          checkedInAt: new Date().toISOString(),
        },
      ],
    });

    vi.mocked(getAdminSessionOptions).mockResolvedValue({
      templates: [{ id: "template-1", title: "Flow", classTypeId: "class-type-1" }],
      teachers: [{ id: "teacher-1", name: "Teacher" }],
      clients: [
        {
          id: "client-2",
          name: "Client Two",
          email: "client2@example.test",
          availableCredits: 3,
          hasAvailableCredits: true,
        },
        {
          id: "client-3",
          name: "Client Three",
          email: "client3@example.test",
          availableCredits: 0,
          hasAvailableCredits: false,
        },
      ],
    });

    render(
      await AdminSessionEditPage({
        params: Promise.resolve({ id: "session-1" }),
        searchParams: Promise.resolve({ success: "Saved." }),
      }),
    );

    expect(vi.mocked(getAdminSessionOptions)).toHaveBeenCalledWith("session-1");
    expect(screen.getByText("Saved.")).toBeInTheDocument();
    expect(screen.getByText("Client One")).toBeInTheDocument();
    expect(screen.getByText("client1@example.test")).toBeInTheDocument();
    expect(screen.getByTestId("session-attendees-section")).toBeInTheDocument();
    expect(screen.getByTestId("admin-attendee-booking-1")).toBeInTheDocument();
    expect(screen.getByText(/Attendance: CHECKED_IN/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark attended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark no-show" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo check-in" })).toBeInTheDocument();

    expect(screen.getByRole("option", { name: /Client Two .*3 credits available/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Client Three .*No credits available/i })).toBeInTheDocument();

    const publishedRow = screen.getByTestId("published-row");
    const actionRow = screen.getByTestId("session-update-actions");
    const publishedCheckbox = screen.getByRole("checkbox", { name: /published/i });
    const updateButton = screen.getByTestId("session-update-button");

    const rowPosition = publishedRow.compareDocumentPosition(actionRow);
    const buttonPosition = publishedCheckbox.compareDocumentPosition(updateButton);

    expect(rowPosition & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(buttonPosition & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
