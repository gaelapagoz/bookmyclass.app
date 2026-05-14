import { beforeEach, describe, expect, it } from "vitest";
import { clearCapturedTestEmails, getCapturedTestEmails } from "../../src/lib/email/resend-delivery";
import { sendPurchaseConfirmationEmail } from "../../src/lib/email/purchase-confirmation-email";

beforeEach(() => {
  clearCapturedTestEmails();
  process.env.E2E_TEST_MODE = "1";
});

describe("sendPurchaseConfirmationEmail", () => {
  it("captures email in test mode with item and total", async () => {
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

    const emails = getCapturedTestEmails();
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.context).toBe("purchase-confirmation");
    expect(email.to).toContain("buyer@example.test");
    expect(email.html).toContain("10-Class Pack");
    expect(email.html).toContain("€150.00");
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

    const email = getCapturedTestEmails()[0]!;
    expect(email.html).toContain("Wallet credit applied");
    expect(email.html).toContain("Paid by card");
    expect(email.html).toContain("Hi there,");
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

    const email = getCapturedTestEmails()[0]!;
    expect(email.html).toContain("Wallet credit applied");
    expect(email.html).not.toContain("Paid by card");
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

    const email = getCapturedTestEmails()[0]!;
    expect(email.html).toContain("Hi Maria,");
  });
});
