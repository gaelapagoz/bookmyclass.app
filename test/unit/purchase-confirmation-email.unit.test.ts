import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureLifecycleEmailTemplate: vi.fn(),
  enqueueLifecycleEmail: vi.fn(),
  attemptImmediateLifecycleDispatch: vi.fn(),
}));

vi.mock("@/lib/email/lifecycle-email-outbox-service", () => ({
  PAYMENT_PURCHASE_CONFIRMATION_TEMPLATE_KEY: "payment.purchase.confirmation",
  ensureLifecycleEmailTemplate: mocks.ensureLifecycleEmailTemplate,
  enqueueLifecycleEmail: mocks.enqueueLifecycleEmail,
  attemptImmediateLifecycleDispatch: mocks.attemptImmediateLifecycleDispatch,
}));

import { sendPurchaseConfirmationEmail } from "../../src/lib/email/purchase-confirmation-email";

function getEnqueueInput() {
  expect(mocks.enqueueLifecycleEmail).toHaveBeenCalledOnce();
  return mocks.enqueueLifecycleEmail.mock.calls[0]?.[0];
}

describe("sendPurchaseConfirmationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureLifecycleEmailTemplate.mockResolvedValue(undefined);
    mocks.enqueueLifecycleEmail.mockResolvedValue(undefined);
    mocks.attemptImmediateLifecycleDispatch.mockResolvedValue(undefined);
  });

  it("enqueues purchase confirmation payload with item and total", async () => {
    await sendPurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: "Jane",
      orderId: "ord_test_01",
      items: [{ name: "10-Class Pack", quantity: 1, lineTotalAmountMinor: 15000, currencyCode: "EUR" }],
      totalAmountMinor: 15000,
      currencyCode: "EUR",
      walletAmountMinor: 0,
      stripeAmountMinor: 15000,
    });

    const enqueueInput = getEnqueueInput();
    expect(enqueueInput).toMatchObject({
      templateKey: "payment.purchase.confirmation",
      recipientEmail: "buyer@example.test",
      idempotencyKey: "payment:purchase-confirmation:ord_test_01",
      payloadJson: {
        deliveryContext: "purchase-confirmation",
        greeting: "Hi Jane,",
        orderSummaryText: "10-Class Pack",
        totalAmountFormatted: "€150.00",
        walletAmountLine: "",
        stripeAmountLine: "Paid by card: €150.00",
      },
    });
    expect(mocks.attemptImmediateLifecycleDispatch).toHaveBeenCalledOnce();
  });

  it("includes wallet contribution row when walletAmountMinor > 0", async () => {
    await sendPurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: null,
      orderId: "ord_test_02",
      items: [{ name: "5-Class Pack", quantity: 1, lineTotalAmountMinor: 8000, currencyCode: "EUR" }],
      totalAmountMinor: 8000,
      currencyCode: "EUR",
      walletAmountMinor: 3000,
      stripeAmountMinor: 5000,
    });

    expect(getEnqueueInput()).toMatchObject({
      payloadJson: {
        greeting: "Hi there,",
        walletAmountLine: "Wallet credit applied: -€30.00",
        stripeAmountLine: "Paid by card: €50.00",
      },
    });
  });

  it("omits payment breakdown when only full wallet payment", async () => {
    await sendPurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: "Alex",
      orderId: "ord_test_03",
      items: [{ name: "Drop-in Class", quantity: 1, lineTotalAmountMinor: 2000, currencyCode: "EUR" }],
      totalAmountMinor: 2000,
      currencyCode: "EUR",
      walletAmountMinor: 2000,
      stripeAmountMinor: 0,
    });

    expect(getEnqueueInput()).toMatchObject({
      payloadJson: {
        greeting: "Hi Alex,",
        walletAmountLine: "Wallet credit applied: -€20.00",
        stripeAmountLine: "",
      },
    });
  });

  it("uses personalised greeting when name provided", async () => {
    await sendPurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: "Maria",
      orderId: "ord_test_04",
      items: [{ name: "Private Pack", quantity: 1, lineTotalAmountMinor: 25000, currencyCode: "EUR" }],
      totalAmountMinor: 25000,
      currencyCode: "EUR",
      walletAmountMinor: 0,
      stripeAmountMinor: 25000,
    });

    expect(getEnqueueInput()).toMatchObject({
      payloadJson: {
        greeting: "Hi Maria,",
      },
    });
  });
});
