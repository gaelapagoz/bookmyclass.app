import "./helpers/setup-env";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "./helpers/db";
import { sendGiftCardIssuanceEmail } from "../../src/lib/email/gift-card-email";
import { sendStorePurchaseConfirmationEmail } from "../../src/lib/email/store-email";
import { sendPurchaseConfirmationEmail } from "../../src/lib/email/purchase-confirmation-email";
import { resetDb } from "./helpers/reset-db";

beforeEach(async () => {
  await resetDb();
  process.env.E2E_TEST_MODE = "1";
});

describe("lifecycle email idempotency contract", () => {
  it("deduplicates gift card issuance emails with the same idempotency key", async () => {
    const idempotencyKey = "idem-test:gift-card-issuance:gc-001";
    const payload = {
      to: "buyer@example.test",
      purchaserName: "Jane",
      plaintextCode: "AAAA-BBBB-CCCC-DDDD",
      amountMinor: 5000,
      idempotencyKey,
    };

    await sendGiftCardIssuanceEmail(payload);
    await sendGiftCardIssuanceEmail(payload);

    const events = await prisma.emailAutomationEvent.findMany({
      where: { idempotencyKey },
    });
    expect(events).toHaveLength(1);
  });

  it("deduplicates store purchase confirmation emails with the same idempotency key", async () => {
    const idempotencyKey = "idem-test:store-purchase:order-001";
    const payload = {
      to: "buyer@example.test",
      purchaserName: "Bob",
      orderId: "order-001",
      idempotencyKey,
      items: [{ name: "Yoga Mat", quantity: 1, unitAmountMinor: 1500, currencyCode: "EUR" }],
    };

    await sendStorePurchaseConfirmationEmail(payload);
    await sendStorePurchaseConfirmationEmail(payload);

    const events = await prisma.emailAutomationEvent.findMany({
      where: { idempotencyKey },
    });
    expect(events).toHaveLength(1);
  });

  it("deduplicates purchase confirmation emails with the same idempotency key", async () => {
    const idempotencyKey = "idem-test:purchase-confirmation:order-002";
    const payload = {
      to: "buyer@example.test",
      purchaserName: "Alice",
      orderId: "order-002",
      idempotencyKey,
      items: [{ name: "Drop-in Class", quantity: 1, lineTotalAmountMinor: 2000, currencyCode: "EUR" }],
      totalAmountMinor: 2000,
      currencyCode: "EUR",
      walletAmountMinor: 0,
      stripeAmountMinor: 2000,
    };

    await sendPurchaseConfirmationEmail(payload);
    await sendPurchaseConfirmationEmail(payload);

    const events = await prisma.emailAutomationEvent.findMany({
      where: { idempotencyKey },
    });
    expect(events).toHaveLength(1);
  });

  it("enforces idempotency key uniqueness across different email paths", async () => {
    const sharedKey = "idem-test:cross-path:shared-key-001";

    await sendGiftCardIssuanceEmail({
      to: "buyer@example.test",
      purchaserName: "Jane",
      plaintextCode: "AAAA-BBBB-CCCC-DDDD",
      amountMinor: 5000,
      idempotencyKey: sharedKey,
    });

    // Second call with the same key from a different email path — must not create a second event.
    await sendStorePurchaseConfirmationEmail({
      to: "buyer@example.test",
      purchaserName: "Jane",
      orderId: "order-x",
      idempotencyKey: sharedKey,
      items: [{ name: "Yoga Mat", quantity: 1, unitAmountMinor: 1500, currencyCode: "EUR" }],
    });

    const events = await prisma.emailAutomationEvent.findMany({
      where: { idempotencyKey: sharedKey },
    });
    expect(events).toHaveLength(1);
  });
});
