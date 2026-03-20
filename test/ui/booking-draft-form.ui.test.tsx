/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingDraftForm } from "../../src/components/book-a-class/service-detail/BookingDraftForm";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BookingDraftForm", () => {
  const assignMock = vi.fn();

  const baseProps = {
    isAuthenticated: false,
    initialValues: {
      customerName: "",
      customerEmail: "",
      customerPhone: "",
    },
    session: {
      sessionId: "session-1",
      serviceId: "service-1",
      serviceSlug: "vinyasa-yoga",
      serviceTitle: "Vinyasa Yoga",
      date: "2026-04-10",
      startTime: "18:00",
      endTime: "19:00",
      capacity: 12,
      availableSpots: 4,
      timezone: "Europe/Brussels",
    },
  } as const;

  beforeEach(() => {
    pushMock.mockReset();
    assignMock.mockReset();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  it("submits and redirects directly to Stripe checkout on payable option", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingIntent: "SINGLE_BOOKING",
            singleSession: {
              priceId: "price-single",
              priceName: "Drop-In Single",
              amountMinor: 2200,
              currencyCode: "EUR",
            },
            existingPlans: [],
            newPlanOptions: [],
            ux: {
              recommended: {
                mode: "SINGLE_SESSION",
                priceId: "price-single",
                entitlementId: null,
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            bookingId: "booking-1",
            status: "PENDING",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          selection: {
            bookingStatus: "PENDING",
            paymentSelection: "SINGLE_SESSION",
            draftAmountMinor: 2200,
            draftCurrencyCode: "EUR",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          checkout: {
            checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123",
          },
        }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/select how you want to continue/i)).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Name"), "Guest User");
    await userEvent.type(screen.getByLabelText("Email"), "guest@example.test");
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /privacy policy/i }));
    await userEvent.click(screen.getByRole("button", { name: /Continue To Secure Checkout/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://checkout.stripe.com/pay/cs_test_123");
    });

    expect(screen.queryByText(/Selected session ID:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Service slug:/i)).not.toBeInTheDocument();
  });

  it("uses existing plan flow outside Stripe", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingIntent: "SINGLE_BOOKING",
            singleSession: {
              priceId: "price-single",
              priceName: "Drop-In Single",
              amountMinor: 2200,
              currencyCode: "EUR",
            },
            existingPlans: [],
            newPlanOptions: [
              {
                priceId: "price-plan",
                priceName: "10-Class Pack One-Time",
                productName: "10-Class Pack",
                amountMinor: 15000,
                currencyCode: "EUR",
              },
            ],
            ux: {
              recommended: {
                mode: "SINGLE_SESSION",
                entitlementId: null,
                priceId: "price-single",
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingIntent: "USE_PLAN",
            singleSession: null,
            existingPlans: [
              {
                entitlementId: "ent-1",
                productName: "10-Class Pack",
                remainingCredits: 8,
              },
            ],
            newPlanOptions: [],
            ux: {
              recommended: {
                mode: "EXISTING_PLAN",
                entitlementId: "ent-1",
                priceId: null,
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          draft: {
            bookingId: "booking-2",
            status: "PENDING",
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          selection: {
            bookingStatus: "CONFIRMED",
            paymentSelection: "EXISTING_PLAN",
            draftAmountMinor: 0,
            draftCurrencyCode: "EUR",
          },
        }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await userEvent.type(screen.getByLabelText("Name"), "Guest User");
    await userEvent.type(screen.getByLabelText("Email"), "guest@example.test");
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("radio", { name: /Use existing plan \/ credits/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm Using Plan" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /privacy policy/i }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Using Plan" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/book-a-class/vinyasa-yoga/payment/success?bookingId=booking-2");
    });

    expect(assignMock).not.toHaveBeenCalled();
  });

  it("shows API error message when draft creation fails", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingIntent: "SINGLE_BOOKING",
            singleSession: {
              priceId: "price-single",
              priceName: "Drop-In Single",
              amountMinor: 2200,
              currencyCode: "EUR",
            },
            existingPlans: [],
            newPlanOptions: [],
            ux: {
              recommended: {
                mode: "SINGLE_SESSION",
                priceId: "price-single",
                entitlementId: null,
              },
            },
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: "This session is full.",
        }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/select how you want to continue/i)).toBeInTheDocument();
    });

    await userEvent.type(screen.getByLabelText("Name"), "Guest User");
    await userEvent.type(screen.getByLabelText("Email"), "guest@example.test");
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /privacy policy/i }));
    await userEvent.click(screen.getByRole("button", { name: /Continue To Secure Checkout/i }));

    await waitFor(() => {
      expect(screen.getByText("This session is full.")).toBeInTheDocument();
    });
  });
});
