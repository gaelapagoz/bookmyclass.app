/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: "user-1",
    },
  })),
}));

vi.mock("@/lib/public-booking/booking-confirmation-view", () => ({
  getBookingConfirmationView: vi.fn(async () => ({
    status: "CONFIRMED",
    paymentSelection: "EXISTING_PLAN",
    className: "Vinyasa Yoga",
    serviceSlug: "vinyasa-yoga",
    dateTime: "10 Apr 2026 · 18:00 - 19:00",
    teacherName: "Ana Ionescu",
    locationName: "Ixelles Studio A",
  })),
}));

import BookingConfirmedPage from "../../src/app/(public)/book-a-class/[serviceSlug]/confirmed/page";

describe("Booking confirmed page", () => {
  it("shows customer-facing booking summary and hides internal identifiers", async () => {
    render(
      await BookingConfirmedPage({
        params: Promise.resolve({ serviceSlug: "vinyasa-yoga" }),
        searchParams: Promise.resolve({ bookingId: "booking-123" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Booking Confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Vinyasa Yoga")).toBeInTheDocument();
    expect(screen.getByText("10 Apr 2026 · 18:00 - 19:00")).toBeInTheDocument();
    expect(screen.getByText("Ana Ionescu")).toBeInTheDocument();
    expect(screen.getByText("Ixelles Studio A")).toBeInTheDocument();
    expect(screen.queryByText(/Booking ID/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/slug/i)).not.toBeInTheDocument();
  });
});
