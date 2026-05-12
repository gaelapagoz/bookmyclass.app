import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  giftCardCodeFindUnique: vi.fn(),
  giftCardCodeCreate: vi.fn(),
  userFindUnique: vi.fn(),
  createGiftCardManualReviewCase: vi.fn(),
  emitGiftCardAlertEvent: vi.fn(),
  sendGiftCardIssuanceEmail: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    giftCardCode: {
      findUnique: mocks.giftCardCodeFindUnique,
      create: mocks.giftCardCodeCreate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock("@/lib/gift-cards/gift-card-reconciliation-service", () => ({
  createGiftCardManualReviewCase: mocks.createGiftCardManualReviewCase,
}));

vi.mock("@/lib/gift-cards/gift-card-events", () => ({
  emitGiftCardAlertEvent: mocks.emitGiftCardAlertEvent,
}));

// Dynamic import mock for the email module
vi.mock("@/lib/email/gift-card-email", () => ({
  sendGiftCardIssuanceEmail: mocks.sendGiftCardIssuanceEmail,
}));

import { Prisma } from "@prisma/client";
import { issueGiftCardCodesForOrder } from "../../src/lib/gift-cards/gift-card-code-service";

const BASE_INPUT = {
  orderId: "order_1",
  clientId: "client_1",
  paymentId: "pay_1",
  items: [{ orderItemId: "item_1", amountMinor: 2500 }],
  currencyCode: "EUR",
};

describe("issueGiftCardCodesForOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGiftCardManualReviewCase.mockResolvedValue(undefined);
    mocks.emitGiftCardAlertEvent.mockResolvedValue(undefined);
    mocks.sendGiftCardIssuanceEmail.mockResolvedValue(undefined);
  });

  describe("first issuance", () => {
    beforeEach(() => {
      // No existing code → new issuance
      mocks.giftCardCodeFindUnique.mockResolvedValue(null);
      mocks.giftCardCodeCreate.mockResolvedValue({ id: "gc_code_1" });
      mocks.userFindUnique.mockResolvedValue({ name: "Alice", email: "alice@example.test" });
    });

    it("sends the issuance email with the plaintext code on first issuance", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.sendGiftCardIssuanceEmail).toHaveBeenCalledOnce();
      const call = mocks.sendGiftCardIssuanceEmail.mock.calls[0]![0] as {
        to: string;
        plaintextCode: string;
        amountMinor: number;
        currencyCode: string;
      };
      expect(call.to).toBe("alice@example.test");
      expect(call.amountMinor).toBe(2500);
      expect(call.currencyCode).toBe("EUR");
      expect(call.plaintextCode).toMatch(/^[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F]{8}$/);
    });

    it("does NOT create a reconciliation note on first issuance", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.createGiftCardManualReviewCase).not.toHaveBeenCalled();
    });

    it("does not throw when the purchaser has no email", async () => {
      mocks.userFindUnique.mockResolvedValue({ name: "No Email User", email: null });

      await expect(issueGiftCardCodesForOrder(BASE_INPUT)).resolves.toBeUndefined();
      expect(mocks.sendGiftCardIssuanceEmail).not.toHaveBeenCalled();
    });

    it("does not throw when the email send fails — fulfillment must complete", async () => {
      mocks.sendGiftCardIssuanceEmail.mockRejectedValue(new Error("SMTP timeout"));

      await expect(issueGiftCardCodesForOrder(BASE_INPUT)).resolves.toBeUndefined();
      expect(mocks.emitGiftCardAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "gift_card.issuance_email_failed" }),
      );
    });
  });

  describe("webhook replay (alreadyIssued)", () => {
    beforeEach(() => {
      // Existing code found → alreadyIssued
      mocks.giftCardCodeFindUnique.mockResolvedValue({
        maskedCode: "XXXXXXXX-XXXXXXXX-XXXXXXXX-ABCD1234",
        status: "ISSUED",
      });
    });

    it("does NOT send an email on replay (plaintext code is unavailable)", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.sendGiftCardIssuanceEmail).not.toHaveBeenCalled();
    });

    it("creates a reconciliation note on replay so ops can verify the first-issuance email", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.createGiftCardManualReviewCase).toHaveBeenCalledOnce();
      const call = mocks.createGiftCardManualReviewCase.mock.calls[0]![0] as {
        reason: string;
        idempotencyKey: string;
        orderId: string;
      };
      expect(call.reason).toBe("GIFT_CARD_CODE_EMAIL_NOT_RESENT_ON_REPLAY");
      expect(call.orderId).toBe("order_1");
      expect(call.idempotencyKey).toContain("order_1");
      expect(call.idempotencyKey).toContain("item_1");
    });

    it("does not throw when the reconciliation note creation fails", async () => {
      mocks.createGiftCardManualReviewCase.mockRejectedValue(new Error("DB error"));

      await expect(issueGiftCardCodesForOrder(BASE_INPUT)).resolves.toBeUndefined();
    });
  });

  describe("issuance failure — generic DB error", () => {
    it("creates a reconciliation note and emits an alert event when code issuance throws", async () => {
      mocks.giftCardCodeFindUnique.mockResolvedValue(null);
      mocks.giftCardCodeCreate.mockRejectedValue(new Error("DB constraint error"));

      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.createGiftCardManualReviewCase).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "GIFT_CARD_CODE_ISSUANCE_FAILED" }),
      );
      expect(mocks.emitGiftCardAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "gift_card.code_issuance_failed" }),
      );
      expect(mocks.sendGiftCardIssuanceEmail).not.toHaveBeenCalled();
    });

    it("does not falsely claim email was sent on generic issuance failure", async () => {
      mocks.giftCardCodeFindUnique.mockResolvedValue(null);
      mocks.giftCardCodeCreate.mockRejectedValue(new Error("FK violation"));

      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.sendGiftCardIssuanceEmail).not.toHaveBeenCalled();
    });
  });

  describe("issuance failure — missing schema (P2021 table not found)", () => {
    function makeP2021Error(): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError(
        "The table `public.GiftCardCode` does not exist in the current database.",
        { code: "P2021", clientVersion: "7.5.0" },
      );
    }

    beforeEach(() => {
      mocks.giftCardCodeFindUnique.mockRejectedValue(makeP2021Error());
    });

    it("uses GIFT_CARD_CODE_TABLE_MISSING reason in reconciliation note", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.createGiftCardManualReviewCase).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "GIFT_CARD_CODE_TABLE_MISSING" }),
      );
    });

    it("does not send the gift-card email when the table is missing", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.sendGiftCardIssuanceEmail).not.toHaveBeenCalled();
    });

    it("includes errorCode in reconciliation note metadata", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      const call = mocks.createGiftCardManualReviewCase.mock.calls[0]![0] as {
        metadata: { errorCode: string };
      };
      expect(call.metadata.errorCode).toBe("GIFT_CARD_CODE_TABLE_MISSING");
    });

    it("emits the gift_card.code_issuance_failed alert event", async () => {
      await issueGiftCardCodesForOrder(BASE_INPUT);

      expect(mocks.emitGiftCardAlertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: "gift_card.code_issuance_failed" }),
      );
    });

    it("does not throw — fulfillment must not crash on missing schema", async () => {
      await expect(issueGiftCardCodesForOrder(BASE_INPUT)).resolves.toBeUndefined();
    });
  });
});
