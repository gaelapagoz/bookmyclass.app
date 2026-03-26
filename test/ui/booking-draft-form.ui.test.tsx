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
    isAuthenticated: true,
    initialValues: {
      customerName: "Guest User",
      customerEmail: "guest@example.test",
      customerPhone: "+32000000010",
    },
    session: {
      sessionId: "session-1",
      serviceId: "service-1",
      serviceSlug: "vinyasa-yoga",
      classTitle: "Vinyasa Yoga",
      dateTime: "10 Apr 2026 · 18:00 - 19:00",
      teacher: "Coach Marie",
      place: "Studio Brussels",
      capacity: 12,
      availableSpots: 4,
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

  it("shows plan purchase option label without price name in combo box", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          paymentOptions: {
            singleSession: null,
            existingPlans: [],
            newPlanOptions: [
              {
                bookingLabel: "Buy a Plan - Unlimited Yoga (€129.00)",
                priceId: "price-plan",
                displayName: "Unlimited Yoga",
                priceName: "Monthly",
                productName: "Unlimited Yoga",
                amountMinor: 12900,
                currencyCode: "EUR",
              },
            ],
            ux: {
              recommended: {
                mode: "NEW_PLAN_PURCHASE",
                entitlementId: null,
                priceId: "price-plan",
              },
            },
          },
        }),
    } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/select how you want to continue/i)).toBeInTheDocument();
    });

    const option = screen.getByRole("option", { name: "Buy a Plan - Unlimited Yoga (€129.00)" });
    expect(option).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Monthly/i })).not.toBeInTheDocument();
  });

  it("submits and redirects directly to Stripe checkout on payable option", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            paymentOptions: {
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
        text: async () =>
          JSON.stringify({
            draft: {
              bookingId: "booking-1",
              status: "PENDING",
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
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
        text: async () =>
          JSON.stringify({
            checkout: {
              checkoutUrl: "https://checkout.stripe.com/pay/cs_test_123",
            },
          }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/select how you want to continue/i)).toBeInTheDocument();
    });

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Guest User");
    await userEvent.clear(screen.getByLabelText("Phone"));
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /no cancellation or rescheduling is permitted within 24 hour/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Continue To Secure Checkout/i }));

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("https://checkout.stripe.com/pay/cs_test_123");
    });

    expect(screen.queryByText(/How do you plan to book\?/i)).not.toBeInTheDocument();
  });

  it("uses existing plan flow outside Stripe", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            paymentOptions: {
              singleSession: null,
              existingPlans: [
                {
                  bookingLabel: "Use Existing Plan - 10-Class Pack",
                  displayName: "10-Class Pack",
                  entitlementId: "ent-1",
                  entitlementType: "CREDIT_PACK",
                  planSource: "CREDITS",
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
        text: async () =>
          JSON.stringify({
            draft: {
              bookingId: "booking-2",
              status: "PENDING",
            },
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            selection: {
              bookingStatus: "CONFIRMED",
              paymentSelection: "EXISTING_PLAN",
              draftAmountMinor: 0,
              draftCurrencyCode: "EUR",
            },
          }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Confirm Using Plan" })).toBeInTheDocument();
    });

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Client User");
    await userEvent.clear(screen.getByLabelText("Phone"));
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /no cancellation or rescheduling is permitted within 24 hour/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Confirm Using Plan" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/book-a-class/vinyasa-yoga/confirmed?bookingId=booking-2");
    });

    expect(assignMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Using 1 credit/i)).toBeInTheDocument();
    expect(screen.getByText(/Credits remaining/i)).toBeInTheDocument();
  });

  it("shows API error message when draft creation fails", async () => {
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            paymentOptions: {
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
        text: async () =>
          JSON.stringify({
            error: "This session is full.",
          }),
      } as Response);

    render(<BookingDraftForm {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/select how you want to continue/i)).toBeInTheDocument();
    });

    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Guest User");
    await userEvent.clear(screen.getByLabelText("Phone"));
    await userEvent.type(screen.getByLabelText("Phone"), "+32000000010");
    await userEvent.click(screen.getByRole("checkbox", { name: /terms and conditions/i }));
    await userEvent.click(
      screen.getByRole("checkbox", { name: /no cancellation or rescheduling is permitted within 24 hour/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /Continue To Secure Checkout/i }));

    await waitFor(() => {
      expect(screen.getByText("This session is full.")).toBeInTheDocument();
    });
  });
  it("renders booking summary with the shared customer-facing fields", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () =>
        JSON.stringify({
          paymentOptions: {
            singleSession: null,
            existingPlans: [],
            newPlanOptions: [],
            ux: {
              recommended: {
                mode: "NO_OPTION",
                priceId: null,
                entitlementId: null,
              },
            },
          },
        }),
    } as Response);

    render(<BookingDraftForm {...baseProps} />);

    expect(screen.getByText("Class")).toBeInTheDocument();
    expect(screen.getByText("Vinyasa Yoga")).toBeInTheDocument();
    expect(screen.getByText("Date & Time")).toBeInTheDocument();
    expect(screen.getByText("10 Apr 2026 · 18:00 - 19:00")).toBeInTheDocument();
    expect(screen.getByText("Teacher")).toBeInTheDocument();
    expect(screen.getByText("Coach Marie")).toBeInTheDocument();
    expect(screen.getByText("Place")).toBeInTheDocument();
    expect(screen.getByText("Studio Brussels")).toBeInTheDocument();
    expect(screen.getByText("Spots left")).toBeInTheDocument();
    expect(screen.queryByText("Timezone")).not.toBeInTheDocument();
    expect(screen.queryByText("Booking Type")).not.toBeInTheDocument();
  });
});


