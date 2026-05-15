import "./helpers/setup-env";

import { beforeEach, describe, expect, it } from "vitest";
import { clearCapturedTestEmails, getCapturedTestEmails } from "../../src/lib/email/resend-delivery";
import { sendGiftCardIssuanceEmail } from "../../src/lib/email/gift-card-email";
import { sendStorePurchaseConfirmationEmail } from "../../src/lib/email/store-email";

beforeEach(() => {
  clearCapturedTestEmails();
  process.env.E2E_TEST_MODE = "1";
});

describe("sendGiftCardIssuanceEmail", () => {
  it("captures an email with plaintext code in test mode", async () => {
    await sendGiftCardIssuanceEmail({
      to: "buyer@example.test",
      purchaserName: "Jane Test",
      plaintextCode: "AABBCCDD-11223344-AABBCCDD-11223344",
      amountMinor: 2500,
      currencyCode: "EUR",
    });

    const emails = getCapturedTestEmails();
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toContain("buyer@example.test");
    expect(email.subject).toBe("Your gift card code");
    expect(email.html).toContain("AABBCCDD-11223344-AABBCCDD-11223344");
    expect(email.context).toBe("gift-card-issuance");
  });

  it("includes greeting with purchaser name", async () => {
    await sendGiftCardIssuanceEmail({
      to: "named@example.test",
      purchaserName: "Alice",
      plaintextCode: "FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF",
      amountMinor: 5000,
    });

    const emails = getCapturedTestEmails();
    expect(emails[0]?.html).toContain("Hi Alice,");
  });

  it("sends a generic greeting when purchaser name is null", async () => {
    await sendGiftCardIssuanceEmail({
      to: "anon@example.test",
      purchaserName: null,
      plaintextCode: "FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF",
      amountMinor: 5000,
    });

    const emails = getCapturedTestEmails();
    expect(emails[0]?.html).toContain("Hi there,");
  });

  it("escapes admin message HTML before interpolation", async () => {
    await sendGiftCardIssuanceEmail({
      to: "safe@example.test",
      purchaserName: null,
      recipientName: "Recipient",
      adminMessage: "<img src=x onerror=alert(1)>\nhello",
      plaintextCode: "FFFFFFFF-FFFFFFFF-FFFFFFFF-FFFFFFFF",
      amountMinor: 5000,
    });

    const html = getCapturedTestEmails()[0]?.html ?? "";
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;<br />hello");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("sendStorePurchaseConfirmationEmail", () => {
  it("captures a purchase confirmation email in test mode", async () => {
    await sendStorePurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: "Bob Test",
      orderId: "test-order-123",
      items: [
        { name: "Studio Tote Bag", quantity: 1, unitAmountMinor: 2200, currencyCode: "EUR" },
      ],
    });

    const emails = getCapturedTestEmails();
    expect(emails).toHaveLength(1);
    const email = emails[0]!;
    expect(email.to).toContain("buyer@example.test");
    expect(email.subject).toContain("Confirmation");
    expect(email.html).toContain("Studio Tote Bag");
    expect(email.html).toContain("€22.00");
    expect(email.context).toBe("store-purchase-confirmation");
  });

  it("includes pickup-at-studio instruction", async () => {
    await sendStorePurchaseConfirmationEmail({
      to: "pickup@example.test",
      purchaserName: null,
      orderId: "test-order-456",
      items: [
        { name: "Yoga Mat", quantity: 2, unitAmountMinor: 1500, currencyCode: "EUR" },
      ],
    });

    const emails = getCapturedTestEmails();
    expect(emails[0]?.html).toContain("Pickup at studio.");
  });
});
