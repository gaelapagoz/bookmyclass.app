/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookingPaymentOptionsStep } from "../../src/components/book-a-class/service-detail/BookingPaymentOptionsStep";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

describe("BookingPaymentOptionsStep", () => {
  const assignMock = vi.fn();

  beforeEach(() => {
    pushMock.mockReset();
    assignMock.mockReset();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, assign: assignMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("single-booking intent proceeds to checkout without re-selection", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingId: "booking-1",
            bookingIntent: "SINGLE_BOOKING",
            singleSession: {
              bookingLabel: "Single Session - Collective Drop-In (€22.00)",
              priceId: "price-single",
              displayName: "Collective Drop-In",
              priceName: "Drop-In Single",
              amountMinor: 2200,
              currencyCode: "EUR",
            },
            existingPlans: [],
            newPlanOptions: [],
            selected: {
              paymentSelection: null,
              selectedEntitlementId: null,
              selectedPriceId: null,
              draftAmountMinor: null,
              draftCurrencyCode: null,
            },
            ux: {
              recommended: {
                mode: "SINGLE_SESSION",
                priceId: "price-single",
                entitlementId: null,
                reason: "Booking intent is single-session; drop-in payment is preselected.",
              },
              requiresChoice: false,
            },
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
            checkoutUrl: "https://checkout.stripe.com/pay/test",
          },
        }),
      } as Response);

    render(<BookingPaymentOptionsStep bookingId="booking-1" serviceSlug="vinyasa-yoga" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Pay .*22\.00/ })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /Pay .*22\.00/ }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://checkout.stripe.com/pay/test");
    });
  });

  it("existing-plan flow confirms internally and stays outside Stripe", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          paymentOptions: {
            bookingId: "booking-2",
            bookingIntent: "USE_PLAN",
            singleSession: null,
            existingPlans: [
              {
                entitlementId: "ent-1",
                bookingLabel: "Use Existing Plan - 10-Class Pack",
                displayName: "10-Class Pack",
                productName: "10-Class Pack",
                remainingCredits: 8,
              },
            ],
            newPlanOptions: [],
            selected: {
              paymentSelection: null,
              selectedEntitlementId: null,
              selectedPriceId: null,
              draftAmountMinor: null,
              draftCurrencyCode: null,
            },
            ux: {
              recommended: {
                mode: "EXISTING_PLAN",
                priceId: null,
                entitlementId: "ent-1",
                reason: "One eligible active plan found; it is preselected.",
              },
              requiresChoice: false,
            },
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

    render(<BookingPaymentOptionsStep bookingId="booking-2" serviceSlug="vinyasa-yoga" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Use Plan And Confirm Booking" })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Use Plan And Confirm Booking" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(
        "/book-a-class/vinyasa-yoga/confirmed?bookingId=booking-2",
      );
    });

    expect(fetchSpy).not.toHaveBeenCalledWith(
      "/api/checkout/session",
      expect.anything(),
    );
  });

  it("use-plan with no active plan shows buy-plan fallback", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        paymentOptions: {
          bookingId: "booking-3",
          bookingIntent: "USE_PLAN",
          singleSession: {
            bookingLabel: "Single Session - Collective Drop-In (€22.00)",
            priceId: "price-single",
            displayName: "Collective Drop-In",
            priceName: "Drop-In Single",
            amountMinor: 2200,
            currencyCode: "EUR",
          },
          existingPlans: [],
          newPlanOptions: [
            {
              bookingLabel: "Buy a Plan - 10-Class Pack (€150.00)",
              priceId: "price-plan",
              displayName: "10-Class Pack",
              priceName: "10-Class Pack One-Time",
              productName: "10-Class Pack",
              amountMinor: 15000,
              currencyCode: "EUR",
            },
          ],
          selected: {
            paymentSelection: null,
            selectedEntitlementId: null,
            selectedPriceId: null,
            draftAmountMinor: null,
            draftCurrencyCode: null,
          },
          ux: {
            recommended: {
              mode: "NEW_PLAN_PURCHASE",
              priceId: "price-plan",
              entitlementId: null,
              reason: "No eligible active plan found; a plan purchase is preselected.",
            },
            requiresChoice: false,
          },
        },
      }),
    } as Response);

    render(<BookingPaymentOptionsStep bookingId="booking-3" serviceSlug="vinyasa-yoga" />);

    await waitFor(() => {
      expect(screen.getAllByText(/No eligible active plan found/i).length).toBeGreaterThan(0);
      expect(screen.getByRole("button", { name: /Pay .*150\.00/ })).toBeInTheDocument();
    });
  });

  it("surfaces API denial when payment options cannot be loaded", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "This booking does not belong to the signed-in user.",
      }),
    } as Response);

    render(<BookingPaymentOptionsStep bookingId="booking-4" serviceSlug="vinyasa-yoga" />);

    await waitFor(() => {
      expect(screen.getByText("This booking does not belong to the signed-in user.")).toBeInTheDocument();
    });
  });
});



