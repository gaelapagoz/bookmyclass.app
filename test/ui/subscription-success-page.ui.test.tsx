/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-auth", () => ({
  requireAuth: vi.fn(async () => ({
    user: {
      id: "user_1",
    },
  })),
}));

vi.mock("@/lib/public-booking/stripe-webhook-service", () => ({
  reconcileCatalogCheckoutSessionAfterReturn: vi.fn(async () => undefined),
}));

import SubscriptionSuccessPage from "../../src/app/(protected)/subscription/success/page";

describe("Subscription success page", () => {
  it("renders corrected success heading", async () => {
    render(
      await SubscriptionSuccessPage({
        searchParams: Promise.resolve({
          session_id: "cs_test_123",
        }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Payment Confirmed" })).toBeInTheDocument();
  });
});
