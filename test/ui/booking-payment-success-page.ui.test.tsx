/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const paymentFindFirstMock = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: "client-123",
    },
  })),
}));

vi.mock("@/lib/public-booking/booking-confirmation-view", () => ({
  getBookingConfirmationView: vi.fn(async () => ({
    status: "CONFIRMED",
    paymentSelection: "SINGLE_SESSION",
    className: "Vinyasa Yoga",
    serviceSlug: "vinyasa-yoga",
    dateTime: "10 Apr 2026 · 18:00 - 19:00",
    teacherName: "Ana Ionescu",
    locationName: "Ixelles Studio A",
  })),
}));

vi.mock("@/lib/public-booking/stripe-webhook-service", () => ({
  reconcileCheckoutSessionAfterReturn: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    payment: {
      findFirst: (...args: unknown[]) => paymentFindFirstMock(...args),
    },
  },
}));

import BookingPaymentSuccessPage from "../../src/app/(public)/book-a-class/[serviceSlug]/payment/success/page";

describe("Booking payment success page", () => {
  it("scopes payment lookup to the authenticated booking owner", async () => {
    paymentFindFirstMock.mockResolvedValue({
      status: "SUCCEEDED",
      failureReason: null,
    });

    render(
      await BookingPaymentSuccessPage({
        params: Promise.resolve({ serviceSlug: "vinyasa-yoga" }),
        searchParams: Promise.resolve({
          bookingId: "booking-123",
          session_id: "cs_test_123",
        }),
      }),
    );

    expect(paymentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: "booking-123",
          booking: { clientId: "client-123" },
        }),
      }),
    );
    expect(screen.getByRole("heading", { name: "Payment Confirmed" })).toBeInTheDocument();
  });
});
