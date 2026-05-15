/* @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminGiftCardGenerationPanel from "../../src/components/admin/gift-cards/AdminGiftCardGenerationPanel";

describe("admin gift card generation panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders form fields and advances to review", async () => {
    const user = userEvent.setup();
    render(<AdminGiftCardGenerationPanel />);

    await user.type(screen.getByLabelText(/amount/i), "25");
    await user.type(screen.getByLabelText(/recipient email/i), "recipient@example.test");
    await user.type(screen.getByLabelText(/internal reason/i), "Support follow-up");
    await user.click(screen.getByRole("button", { name: "Review" }));

    expect(screen.getByRole("heading", { name: "Review" })).toBeVisible();
    expect(screen.getByText("recipient@example.test")).toBeVisible();
    expect(screen.getAllByText(/no wallet balance is credited until redemption/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Generate and Send" })).toBeVisible();
  });

  it("submits and shows masked-code confirmation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch" as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "gc_1",
        maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCDEF12",
        amountMinor: 2500,
        currencyCode: "EUR",
        recipientEmail: "recipient@example.test",
        recipientName: null,
        emailStatus: "SENT",
      }),
    } as Response);

    render(<AdminGiftCardGenerationPanel />);

    await user.type(screen.getByLabelText(/amount/i), "25");
    await user.type(screen.getByLabelText(/recipient email/i), "recipient@example.test");
    await user.type(screen.getByLabelText(/internal reason/i), "Support follow-up");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Generate and Send" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { amountMinor?: number };
    expect(requestBody.amountMinor).toBe(2500);
    expect(screen.getByText("Gift card generated")).toBeVisible();
    expect(screen.getByText(/No plaintext code is available after submit/i)).toBeVisible();
  });

  it("reuses one idempotency key for repeated submit attempts in the same review session", async () => {
    const user = userEvent.setup();
    const responses: Array<{ ok: boolean; json: () => Promise<unknown> }> = [
      { ok: false, json: async () => ({ code: "GIFT_CARD_ADMIN_EMAIL_DELIVERY_FAILED" }) },
      {
        ok: true,
        json: async () => ({
          id: "gc_1",
          maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCDEF12",
          amountMinor: 2500,
          currencyCode: "EUR",
          recipientEmail: "recipient@example.test",
          recipientName: null,
          emailStatus: "FAILED",
        }),
      },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch" as never).mockImplementation(async (_input, _init) => {
      const next = responses.shift();
      if (!next) {
        throw new Error("No more mocked responses");
      }
      return {
        ok: next.ok,
        json: next.json,
      } as Response;
    });

    render(<AdminGiftCardGenerationPanel />);

    await user.type(screen.getByLabelText(/amount/i), "25");
    await user.type(screen.getByLabelText(/recipient email/i), "recipient@example.test");
    await user.type(screen.getByLabelText(/internal reason/i), "Support follow-up");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Generate and Send" }));
    await user.click(screen.getByRole("button", { name: "Generate and Send" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { idempotencyKey?: string };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}")) as { idempotencyKey?: string };
    expect(firstBody.idempotencyKey).toBeTruthy();
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
  });

  it("converts euros to minor units before submission", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch" as never).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "gc_1",
        maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCDEF12",
        amountMinor: 10000,
        currencyCode: "EUR",
        recipientEmail: "recipient@example.test",
        recipientName: null,
        emailStatus: "SENT",
      }),
    } as Response);

    render(<AdminGiftCardGenerationPanel />);
    await user.type(screen.getByLabelText(/amount/i), "100");
    await user.type(screen.getByLabelText(/recipient email/i), "recipient@example.test");
    await user.type(screen.getByLabelText(/internal reason/i), "Support follow-up");
    await user.click(screen.getByRole("button", { name: "Review" }));
    await user.click(screen.getByRole("button", { name: "Generate and Send" }));

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { amountMinor?: number };
    expect(requestBody.amountMinor).toBe(10000);
  });
});
