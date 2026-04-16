/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
const checkInBookingFromKioskMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: refreshMock,
  }),
}));

vi.mock("@/app/kiosk/[sessionId]/actions", () => ({
  checkInBookingFromKiosk: (input: unknown) => checkInBookingFromKioskMock(input),
}));

import { CheckInButton } from "../../src/app/kiosk/[sessionId]/check-in-button";

describe("kiosk check-in button", () => {
  it("shows success feedback after successful check-in", async () => {
    checkInBookingFromKioskMock.mockResolvedValueOnce(undefined);

    render(<CheckInButton bookingId="booking-1" sessionId="session-1" />);

    await userEvent.click(screen.getByTestId("kiosk-check-in-booking-1"));
    await waitFor(() => {
      expect(checkInBookingFromKioskMock).toHaveBeenCalledWith({
        bookingId: "booking-1",
        sessionId: "session-1",
      });
    });
    expect(screen.getByText("Checked in.")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows error feedback when check-in fails", async () => {
    checkInBookingFromKioskMock.mockRejectedValueOnce(new Error("CHECKIN_WINDOW_CLOSED"));

    render(<CheckInButton bookingId="booking-2" sessionId="session-2" />);

    await userEvent.click(screen.getByTestId("kiosk-check-in-booking-2"));
    await waitFor(() => {
      expect(checkInBookingFromKioskMock).toHaveBeenCalled();
    });
    expect(screen.getByText(/Check-in failed/i)).toBeInTheDocument();
  });
});

