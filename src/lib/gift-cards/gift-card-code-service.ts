import { createHash, randomBytes } from "node:crypto";
import { GiftCardCodeStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activateGiftCardValue } from "./gift-card-wallet-service";
import { createGiftCardManualReviewCase } from "./gift-card-reconciliation-service";
import { emitGiftCardAlertEvent } from "./gift-card-events";
import { GIFT_CARD_CURRENCY_CODE } from "./gift-card-types";

const GIFT_CARD_CODE_EXPIRY_DAYS =
  typeof process.env.GIFT_CARD_CODE_EXPIRY_DAYS === "string" &&
  process.env.GIFT_CARD_CODE_EXPIRY_DAYS.trim().length > 0
    ? parseInt(process.env.GIFT_CARD_CODE_EXPIRY_DAYS, 10)
    : null;

export type IssueGiftCardCodeInput = {
  readonly orderId: string;
  readonly orderItemId: string;
  readonly purchasedById: string;
  readonly amountMinor: number;
  readonly currencyCode?: string;
};

export type IssueGiftCardCodeResult =
  | { alreadyIssued: false; maskedCode: string; plaintextCode: string }
  | { alreadyIssued: true; maskedCode: string };

export type RedeemGiftCardCodeInput = {
  readonly redeemerUserId: string;
  readonly redeemerClientId: string;
  readonly plaintextCode: string;
};

export type RedeemGiftCardCodeResult = {
  readonly newBalanceMinor: number;
  readonly currencyCode: string;
  readonly amountRedeemedMinor: number;
};

function hashCode(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function generatePlaintextCode(): string {
  const bytes = randomBytes(16);
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24, 32)}`;
}

function maskCode(plaintext: string): string {
  const parts = plaintext.split("-");
  const last = parts[parts.length - 1] ?? "????";
  const masked = parts.slice(0, -1).map(() => "XXXXXXXX");
  return [...masked, last].join("-");
}

function normalizeInputCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

function restoreCodeFormat(normalized: string): string {
  if (normalized.length !== 32) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 16)}-${normalized.slice(16, 24)}-${normalized.slice(24, 32)}`;
}

export async function issueGiftCardCode(input: IssueGiftCardCodeInput): Promise<IssueGiftCardCodeResult> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;

  const existing = await prisma.giftCardCode.findUnique({
    where: { orderItemId: input.orderItemId },
    select: { maskedCode: true, status: true },
  });

  if (existing) {
    return { alreadyIssued: true, maskedCode: existing.maskedCode };
  }

  const plaintextCode = generatePlaintextCode();
  const codeHash = hashCode(plaintextCode);
  const maskedCode = maskCode(plaintextCode);
  const issuedAt = new Date();
  const expiresAt =
    typeof GIFT_CARD_CODE_EXPIRY_DAYS === "number" && GIFT_CARD_CODE_EXPIRY_DAYS > 0
      ? new Date(issuedAt.getTime() + GIFT_CARD_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
      : null;

  try {
    await prisma.giftCardCode.create({
      data: {
        orderId: input.orderId,
        orderItemId: input.orderItemId,
        purchasedById: input.purchasedById,
        codeHash,
        maskedCode,
        amountMinor: input.amountMinor,
        currencyCode,
        status: GiftCardCodeStatus.ISSUED,
        issuedAt,
        expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Race condition: another process issued the code first
      const raceExisting = await prisma.giftCardCode.findUnique({
        where: { orderItemId: input.orderItemId },
        select: { maskedCode: true },
      });
      if (raceExisting) {
        return { alreadyIssued: true, maskedCode: raceExisting.maskedCode };
      }
    }
    throw error;
  }

  return { alreadyIssued: false, maskedCode, plaintextCode };
}

export async function issueGiftCardCodesForOrder(input: {
  orderId: string;
  clientId: string;
  paymentId?: string;
  items: Array<{ orderItemId: string; amountMinor: number }>;
  currencyCode?: string;
}): Promise<void> {
  for (const item of input.items) {
    try {
      const result = await issueGiftCardCode({
        orderId: input.orderId,
        orderItemId: item.orderItemId,
        purchasedById: input.clientId,
        amountMinor: item.amountMinor,
        currencyCode: input.currencyCode,
      });

      if (result.alreadyIssued) {
        continue;
      }

      // Send issuance email (non-blocking — imported lazily to avoid circular dep)
      try {
        const { sendGiftCardIssuanceEmail } = await import("@/lib/email/gift-card-email");
        const purchaser = await prisma.user.findUnique({
          where: { id: input.clientId },
          select: { name: true, email: true },
        });
        if (purchaser?.email) {
          await sendGiftCardIssuanceEmail({
            to: purchaser.email,
            purchaserName: purchaser.name,
            plaintextCode: result.plaintextCode,
            amountMinor: item.amountMinor,
            currencyCode: input.currencyCode ?? GIFT_CARD_CURRENCY_CODE,
          });
        }
      } catch (emailError) {
        // Email failure must not block checkout completion
        console.error("[gift-card-code] issuance email failed", emailError instanceof Error ? emailError.message : String(emailError));
        await emitGiftCardAlertEvent({
          eventName: "gift_card.issuance_email_failed",
          entityType: "GiftCardCode",
          entityId: item.orderItemId,
          metadata: { orderId: input.orderId, clientId: input.clientId },
          error: emailError,
        });
      }
    } catch (issueError) {
      console.error("[gift-card-code] code issuance failed", issueError instanceof Error ? issueError.message : String(issueError));
      await createGiftCardManualReviewCase({
        orderId: input.orderId,
        clientId: input.clientId,
        paymentId: input.paymentId ?? null,
        reason: "GIFT_CARD_CODE_ISSUANCE_FAILED",
        idempotencyKey: `gift-card:code-issuance-failed:order:${input.orderId}:item:${item.orderItemId}`,
        metadata: {
          orderItemId: item.orderItemId,
          amountMinor: item.amountMinor,
          source: "gift-card-code-service",
        },
      });
      await emitGiftCardAlertEvent({
        eventName: "gift_card.code_issuance_failed",
        entityType: "Order",
        entityId: input.orderId,
        metadata: {
          orderId: input.orderId,
          clientId: input.clientId,
          orderItemId: item.orderItemId,
        },
        error: issueError,
      });
    }
  }
}

export async function lookupGiftCardCodeForRedemption(plaintextCode: string): Promise<{
  id: string;
  orderId: string;
  orderItemId: string;
  status: GiftCardCodeStatus;
  amountMinor: number;
  currencyCode: string;
  expiresAt: Date | null;
  purchasedById: string;
} | null> {
  const normalized = normalizeInputCode(plaintextCode);
  const formatted = restoreCodeFormat(normalized);
  const codeHash = hashCode(formatted);

  const record = await prisma.giftCardCode.findUnique({
    where: { codeHash },
    select: {
      id: true,
      orderId: true,
      orderItemId: true,
      status: true,
      amountMinor: true,
      currencyCode: true,
      expiresAt: true,
      purchasedById: true,
    },
  });

  return record;
}

export type GiftCardRedemptionErrorCode =
  | "INVALID_OR_USED"
  | "RATE_LIMITED"
  | "WALLET_ERROR";

export class GiftCardCodeRedemptionError extends Error {
  constructor(
    readonly errorCode: GiftCardRedemptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GiftCardCodeRedemptionError";
  }
}

export async function redeemGiftCardCode(input: RedeemGiftCardCodeInput): Promise<RedeemGiftCardCodeResult> {
  const { checkAndRecordDbRateLimit } = await import("@/lib/security/db-rate-limit");
  const rateLimit = await checkAndRecordDbRateLimit(
    "gift-card-code-redemption",
    input.redeemerUserId,
    { maxAttempts: 5, windowMs: 15 * 60 * 1000 },
  );
  if (!rateLimit.allowed) {
    throw new GiftCardCodeRedemptionError("RATE_LIMITED", "Too many redemption attempts. Please try again later.");
  }

  const record = await lookupGiftCardCodeForRedemption(input.plaintextCode);

  // Use a single generic message for all failure cases — do not reveal which condition matched
  const genericError = new GiftCardCodeRedemptionError("INVALID_OR_USED", "Invalid or already used gift card code.");

  if (!record) {
    throw genericError;
  }
  if (record.status === GiftCardCodeStatus.REDEEMED) {
    throw genericError;
  }
  if (record.status === GiftCardCodeStatus.VOIDED) {
    throw genericError;
  }
  if (
    record.status === GiftCardCodeStatus.EXPIRED ||
    (record.expiresAt !== null && record.expiresAt < new Date())
  ) {
    throw genericError;
  }
  if (record.status !== GiftCardCodeStatus.ISSUED) {
    throw genericError;
  }

  // Mark the code as REDEEMED first; idempotency on wallet activation prevents double-credit
  const updated = await prisma.giftCardCode.updateMany({
    where: { id: record.id, status: GiftCardCodeStatus.ISSUED },
    data: {
      status: GiftCardCodeStatus.REDEEMED,
      redeemedById: input.redeemerUserId,
      redeemedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    // Race: another concurrent request already redeemed it
    throw genericError;
  }

  try {
    const activation = await activateGiftCardValue({
      actor: { type: "USER", userId: input.redeemerUserId, role: Role.CLIENT },
      clientId: input.redeemerClientId,
      orderId: record.orderId,
      orderItemId: record.orderItemId,
      amountMinor: record.amountMinor,
      currencyCode: record.currencyCode,
      idempotencyKey: `redeem:${record.id}`,
      metadata: { source: "gift-card-code-redemption", redeemerUserId: input.redeemerUserId },
    });

    return {
      newBalanceMinor: activation.wallet.balanceMinor,
      currencyCode: activation.wallet.currencyCode,
      amountRedeemedMinor: record.amountMinor,
    };
  } catch (walletError) {
    // Rollback the status update so the code can be retried
    await prisma.giftCardCode.update({
      where: { id: record.id },
      data: {
        status: GiftCardCodeStatus.ISSUED,
        redeemedById: null,
        redeemedAt: null,
      },
    });
    console.error("[gift-card-code] wallet activation failed during redemption", walletError instanceof Error ? walletError.message : String(walletError));
    throw new GiftCardCodeRedemptionError("WALLET_ERROR", "Gift card redemption could not be completed. Please try again.");
  }
}
