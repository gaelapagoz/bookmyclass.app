/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/dashboard/dashboard-service", () => ({
  DashboardServiceError: class DashboardServiceError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  getDashboardBookingsData: vi.fn(),
  cancelClientBooking: vi.fn(),
  cancelClientWaitlistEntry: vi.fn(),
}));

vi.mock("@/lib/attendance/attendance-service", () => ({
  checkInBooking: vi.fn(),
}));

vi.mock("@/lib/site-settings/site-settings-service", () => ({
  getSiteTimeZone: vi.fn(),
}));

import { requireAuth } from "@/lib/auth/require-auth";
import { getDashboardBookingsData } from "@/lib/dashboard/dashboard-service";
import { getSiteTimeZone } from "@/lib/site-settings/site-settings-service";
import DashboardBookingsPage from "../../src/app/(protected)/dashboard/bookings/page";

describe("DashboardBookingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(requireAuth).mockResolvedValue({ user: { id: "client-1" } } as Awaited<ReturnType<typeof requireAuth>>);
    vi.mocked(getSiteTimeZone).mockResolvedValue("Europe/Brussels");
    vi.mocked(getDashboardBookingsData).mockResolvedValue({
      upcoming: [
        {
          bookingId: "booking-1",
          status: "CONFIRMED",
          serviceTitle: "Evening Flow",
          startsAt: "2030-01-02T18:00:00.000Z",
          endsAt: "2030-01-02T19:00:00.000Z",
          location: "Studio A",
          cancellationEligibleUntilAt: "2030-01-01T18:00:00.000Z",
          canCancel: true,
          cancellationBlockedReason: null,
          canCheckIn: false,
          checkInBlockedReason: "Outside check-in window",
          isCheckedIn: false,
        },
      ],
      past: [],
      cancelled: [],
      waitlist: [
        {
          waitlistEntryId: "waitlist-1",
          serviceTitle: "Morning Pilates",
          startsAt: "2030-01-03T09:00:00.000Z",
          endsAt: "2030-01-03T10:00:00.000Z",
          location: "Studio B",
          joinedAt: "2030-01-01T09:00:00.000Z",
        },
      ],
    });
  });

  it("renders waitlist entries and waitlist cancel action", async () => {
    render(await DashboardBookingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "My Bookings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Waitlist" })).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-waitlist-waitlist-1")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-waitlist-cancel-waitlist-1")).toBeInTheDocument();
    expect(screen.queryByText(/position/i)).not.toBeInTheDocument();
  });

  it("requires confirmation before submitting booking cancellation", async () => {
    render(await DashboardBookingsPage({ searchParams: Promise.resolve({}) }));

    fireEvent.click(screen.getByTestId("dashboard-cancel-booking-1"));

    const dialog = screen.getByRole("dialog", { name: "Cancel booking?" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass("fixed", "inset-0", "m-auto", "max-w-sm");
    expect(screen.getByRole("button", { name: "Keep booking" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm cancellation" })).toBeInTheDocument();
  });

  it("formats booking and waitlist times in the configured site timezone", async () => {
    vi.mocked(getSiteTimeZone).mockResolvedValue("America/New_York");
    vi.mocked(getDashboardBookingsData).mockResolvedValue({
      upcoming: [
        {
          bookingId: "booking-ny",
          status: "CONFIRMED",
          serviceTitle: "Late Flow",
          startsAt: "2030-01-02T23:30:00.000Z",
          endsAt: "2030-01-03T00:30:00.000Z",
          location: "Studio A",
          cancellationEligibleUntilAt: "2030-01-01T23:30:00.000Z",
          canCancel: true,
          cancellationBlockedReason: null,
          canCheckIn: false,
          checkInBlockedReason: null,
          isCheckedIn: false,
        },
      ],
      past: [],
      cancelled: [],
      waitlist: [
        {
          waitlistEntryId: "waitlist-ny",
          serviceTitle: "Late Pilates",
          startsAt: "2030-01-02T23:30:00.000Z",
          endsAt: "2030-01-03T00:30:00.000Z",
          location: "Studio B",
          joinedAt: "2030-01-01T09:00:00.000Z",
        },
      ],
    });

    render(await DashboardBookingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getAllByText("02 Jan 2030, 18:30")).toHaveLength(2);
    expect(screen.queryByText("03 Jan 2030, 00:30")).not.toBeInTheDocument();
  });

  it("shows waitlist empty state when there are no active entries", async () => {
    vi.mocked(getDashboardBookingsData).mockResolvedValue({
      upcoming: [],
      past: [],
      cancelled: [],
      waitlist: [],
    });

    render(await DashboardBookingsPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("No active waitlist entries.")).toBeInTheDocument();
  });
});
