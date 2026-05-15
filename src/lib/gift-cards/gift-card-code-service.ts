import { createHash, randomBytes } from "node:crypto";
import {
  GiftCardCodeEmailStatus,
  GiftCardCodeSource,
  GiftCardCodeStatus,
  OrderStatus,
  PriceType,
  Prisma,
  ProductType,
  Role,
  StripeSyncStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { activateGiftCardValue } from "./gift-card-wallet-service";
import { createGiftCardManualReviewCase } from "./gift-card-reconciliation-service";
import { emitGiftCardAlertEvent } from "./gift-card-events";
import { giftCardError, GiftCardError, GiftCardIdempotencyConflictError, giftCardErrorCodes } from "./gift-card-errors";
import { GIFT_CARD_CURRENCY_CODE } from "./gift-card-types";
import { z } from "zod";

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

export type GenerateAdminGiftCardCodeInput = {
  readonly actor: { readonly userId: string; readonly role: Role };
  readonly generatedById?: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly recipientEmail: string;
  readonly recipientName?: string | null;
  readonly adminMessage?: string | null;
  readonly adminReason: string;
  readonly expiresAt?: Date | string | null;
  readonly currencyCode?: string;
};

export type GenerateAdminGiftCardCodeResult = {
  readonly id: string;
  readonly source: GiftCardCodeSource;
  readonly status: GiftCardCodeStatus;
  readonly maskedCode: string;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly recipientEmail: string;
  readonly recipientName: string | null;
  readonly issuedAt: Date;
  readonly emailStatus: GiftCardCodeEmailStatus;
  readonly emailSentAt: Date | null;
};

export type VoidGiftCardCodeInput = {
  readonly codeId: string;
  readonly actor: { readonly userId: string; readonly role: Role };
  readonly actorUserId?: string;
  readonly reason: string;
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

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function createAdminGeneratedOrderContext(input: {
  generatedById: string;
  amountMinor: number;
  currencyCode: string;
}) {
  const suffix = randomBytes(6).toString("hex");
  const product = await prisma.product.create({
    data: {
      name: "Admin Gift Card Issuance",
      slug: `admin-gift-card-${suffix}`,
      productType: ProductType.GIFT_CARD,
      isActive: false,
      isArchived: true,
      sortOrder: 0,
    },
    select: { id: true },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `admin-gift-card-${suffix}`,
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
      name: "Admin Gift Card Issuance",
      priceType: PriceType.ONE_TIME,
      currencyCode: input.currencyCode,
      unitAmountMinor: input.amountMinor,
      isActive: false,
      isArchived: true,
    },
    select: { id: true },
  });

  const order = await prisma.order.create({
    data: {
      clientId: input.generatedById,
      subtotalAmountMinor: input.amountMinor,
      totalAmountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
      status: OrderStatus.PAID,
    },
    select: { id: true },
  });

  const orderItem = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      productNameSnapshot: "Admin Gift Card Issuance",
      priceNameSnapshot: "Admin Gift Card Issuance",
      quantity: 1,
      unitAmountMinor: input.amountMinor,
      lineSubtotalAmountMinor: input.amountMinor,
      lineTotalAmountMinor: input.amountMinor,
      currencyCode: input.currencyCode,
    },
    select: { id: true },
  });

  return {
    orderId: order.id,
    orderItemId: orderItem.id,
  };
}

const adminGiftCardInputSchema = z.object({
  actor: z.object({
    userId: z.string().trim().min(1),
    role: z.enum([Role.ADMIN, Role.MASTER_ADMIN]),
  }),
  generatedById: z.string().trim().min(1).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  recipientEmail: z.email().trim().toLowerCase(),
  recipientName: z.string().trim().max(200).optional().nullable(),
  adminMessage: z.string().trim().max(2000).optional().nullable(),
  adminReason: z.string().trim().min(1).max(500),
  expiresAt: z.coerce.date().optional().nullable(),
  currencyCode: z.string().trim().toUpperCase().optional(),
});

const voidGiftCardInputSchema = z.object({
  codeId: z.string().trim().min(1),
  actor: z.object({
    userId: z.string().trim().min(1),
    role: z.enum([Role.ADMIN, Role.MASTER_ADMIN]),
  }),
  actorUserId: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).max(500),
});

async function assertTrustedAdminActor(trustedActor: { userId: string; role: Role }): Promise<void> {
  if (trustedActor.role !== Role.ADMIN && trustedActor.role !== Role.MASTER_ADMIN) {
    throw giftCardError(giftCardErrorCodes.adminActorForbidden);
  }

  const persistedActor = await prisma.user.findUnique({
    where: { id: trustedActor.userId },
    select: { role: true },
  });

  if (!persistedActor || persistedActor.role !== trustedActor.role) {
    throw giftCardError(giftCardErrorCodes.adminActorForbidden);
  }
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
        source: GiftCardCodeSource.PURCHASED,
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
        // Plaintext code is not stored — email cannot be resent on replay. Create a
        // reconciliation note so ops can confirm the email was sent on first issuance.
        await createGiftCardManualReviewCase({
          orderId: input.orderId,
          clientId: input.clientId,
          paymentId: input.paymentId ?? null,
          reason: "GIFT_CARD_CODE_EMAIL_NOT_RESENT_ON_REPLAY",
          idempotencyKey: `gift-card:email-not-resent:order:${input.orderId}:item:${item.orderItemId}`,
          metadata: {
            orderItemId: item.orderItemId,
            amountMinor: item.amountMinor,
            source: "gift-card-code-service",
            note: "Code already issued; plaintext unavailable for resend. Verify email was sent on first issuance.",
          },
        }).catch(() => {
          // reconciliation note failure must never block fulfillment
        });
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
      // Detect missing-table error (P2021) separately for actionable ops output.
      const isSchemaMissing =
        issueError instanceof Prisma.PrismaClientKnownRequestError &&
        issueError.code === "P2021";

      const errorCode = isSchemaMissing ? "GIFT_CARD_CODE_TABLE_MISSING" : "GIFT_CARD_CODE_ISSUANCE_FAILED";

      if (isSchemaMissing) {
        console.error(
          "[gift-card-code] GiftCardCode table not found. Run: npx prisma migrate deploy && npx prisma generate",
          { orderId: input.orderId, orderItemId: item.orderItemId },
        );
      } else {
        const safeMessage = issueError instanceof Error ? issueError.name : "UnknownError";
        console.error("[gift-card-code] code issuance failed", safeMessage, {
          orderId: input.orderId,
          orderItemId: item.orderItemId,
        });
      }

      await createGiftCardManualReviewCase({
        orderId: input.orderId,
        clientId: input.clientId,
        paymentId: input.paymentId ?? null,
        reason: errorCode,
        idempotencyKey: `gift-card:code-issuance-failed:order:${input.orderId}:item:${item.orderItemId}`,
        metadata: {
          orderItemId: item.orderItemId,
          amountMinor: item.amountMinor,
          source: "gift-card-code-service",
          errorCode,
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
          errorCode,
        },
        error: issueError,
      });
    }
  }
}

export async function generateAdminGiftCardCode(input: GenerateAdminGiftCardCodeInput): Promise<GenerateAdminGiftCardCodeResult> {
  const parsed = adminGiftCardInputSchema.parse(input);
  await assertTrustedAdminActor(parsed.actor);
  if (parsed.generatedById && parsed.generatedById !== parsed.actor.userId) {
    throw giftCardError(giftCardErrorCodes.adminActorForbidden);
  }
  const currencyCode = parsed.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  const expiresAt = parsed.expiresAt ?? null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new Error("GIFT_CARD_EXPIRY_IN_PAST");
  }
  const normalizedRecipientName = normalizeNullableText(parsed.recipientName);
  const normalizedAdminMessage = normalizeNullableText(parsed.adminMessage);

  const pendingOrFailedForSameIntent = await prisma.giftCardCode.findFirst({
    where: {
      source: GiftCardCodeSource.ADMIN_GENERATED,
      generatedById: parsed.actor.userId,
      amountMinor: parsed.amountMinor,
      currencyCode,
      recipientEmail: parsed.recipientEmail,
      recipientName: normalizedRecipientName,
      adminMessage: normalizedAdminMessage,
      adminReason: parsed.adminReason,
      expiresAt,
      status: GiftCardCodeStatus.ISSUED,
      emailStatus: { in: [GiftCardCodeEmailStatus.PENDING, GiftCardCodeEmailStatus.FAILED] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      source: true,
      status: true,
      maskedCode: true,
      amountMinor: true,
      currencyCode: true,
      recipientEmail: true,
      recipientName: true,
      issuedAt: true,
      emailStatus: true,
      emailSentAt: true,
    },
  });

  if (pendingOrFailedForSameIntent) {
    return pendingOrFailedForSameIntent as GenerateAdminGiftCardCodeResult;
  }

  const existingByKey = await prisma.giftCardCode.findUnique({
    where: { adminIdempotencyKey: parsed.idempotencyKey },
    select: {
      id: true,
      source: true,
      status: true,
      maskedCode: true,
      amountMinor: true,
      currencyCode: true,
      recipientEmail: true,
      recipientName: true,
      adminMessage: true,
      adminReason: true,
      expiresAt: true,
      generatedById: true,
      issuedAt: true,
      emailStatus: true,
      emailSentAt: true,
    },
  });
  if (existingByKey) {
    const samePayload =
      existingByKey.generatedById === parsed.actor.userId &&
      existingByKey.amountMinor === parsed.amountMinor &&
      existingByKey.currencyCode === currencyCode &&
      existingByKey.recipientEmail === parsed.recipientEmail &&
      (existingByKey.recipientName ?? null) === normalizedRecipientName &&
      (existingByKey.adminMessage ?? null) === normalizedAdminMessage &&
      (existingByKey.adminReason ?? "") === parsed.adminReason &&
      (existingByKey.expiresAt?.getTime() ?? null) === (expiresAt?.getTime() ?? null);

    if (!samePayload) {
      throw giftCardError(giftCardErrorCodes.adminIdempotencyPayloadMismatch);
    }
    return existingByKey as GenerateAdminGiftCardCodeResult;
  }

  const plaintextCode = generatePlaintextCode();
  const codeHash = hashCode(plaintextCode);
  const maskedCode = maskCode(plaintextCode);
  const issuedAt = new Date();
  const orderContext = await createAdminGeneratedOrderContext({
    generatedById: parsed.actor.userId,
    amountMinor: parsed.amountMinor,
    currencyCode,
  });

  let created: GenerateAdminGiftCardCodeResult;
  try {
    created = await prisma.giftCardCode.create({
      data: {
        source: GiftCardCodeSource.ADMIN_GENERATED,
        adminIdempotencyKey: parsed.idempotencyKey,
        orderId: orderContext.orderId,
        orderItemId: orderContext.orderItemId,
        purchasedById: null,
        generatedById: parsed.actor.userId,
        recipientEmail: parsed.recipientEmail,
        recipientName: normalizedRecipientName,
        adminMessage: normalizedAdminMessage,
        adminReason: parsed.adminReason,
        codeHash,
        maskedCode,
        amountMinor: parsed.amountMinor,
        currencyCode,
        status: GiftCardCodeStatus.ISSUED,
        issuedAt,
        expiresAt,
        emailStatus: GiftCardCodeEmailStatus.PENDING,
      },
      select: {
        id: true,
        source: true,
        status: true,
        maskedCode: true,
        amountMinor: true,
        currencyCode: true,
        recipientEmail: true,
        recipientName: true,
        issuedAt: true,
        emailStatus: true,
        emailSentAt: true,
      },
    }) as GenerateAdminGiftCardCodeResult;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raceExisting = await prisma.giftCardCode.findUnique({
        where: { adminIdempotencyKey: parsed.idempotencyKey },
        select: {
          id: true,
          source: true,
          status: true,
          maskedCode: true,
          amountMinor: true,
          currencyCode: true,
          recipientEmail: true,
          recipientName: true,
          issuedAt: true,
          emailStatus: true,
          emailSentAt: true,
        },
      });
      if (raceExisting) {
        return raceExisting as GenerateAdminGiftCardCodeResult;
      }
    }
    throw error;
  }

  try {
    const { sendGiftCardIssuanceEmail } = await import("@/lib/email/gift-card-email");
    await sendGiftCardIssuanceEmail({
      to: parsed.recipientEmail,
      purchaserName: null,
      recipientName: parsed.recipientName ?? null,
      adminMessage: parsed.adminMessage ?? null,
      plaintextCode,
      amountMinor: parsed.amountMinor,
      currencyCode,
    });

    const updated = await prisma.giftCardCode.update({
      where: { id: created.id },
      data: {
        emailStatus: GiftCardCodeEmailStatus.SENT,
        emailSentAt: new Date(),
      },
      select: {
        id: true,
        source: true,
        status: true,
        maskedCode: true,
        amountMinor: true,
        currencyCode: true,
        recipientEmail: true,
        recipientName: true,
        issuedAt: true,
        emailStatus: true,
        emailSentAt: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        actorId: parsed.actor.userId,
        actionType: "GIFT_CARD_CODE_ADMIN_GENERATED",
        entityType: "GiftCardCode",
        entityId: created.id,
        metadata: {
          source: "gift-card-code-service",
          idempotencyKey: parsed.idempotencyKey,
          recipientEmail: parsed.recipientEmail,
        },
      },
    });
    return updated as GenerateAdminGiftCardCodeResult;
  } catch (_emailError) {
    await prisma.giftCardCode.update({
      where: { id: created.id },
      data: {
        emailStatus: GiftCardCodeEmailStatus.FAILED,
      },
    });
    throw giftCardError(giftCardErrorCodes.adminEmailDeliveryFailed);
  }
}

export async function voidGiftCardCode(input: VoidGiftCardCodeInput): Promise<{ codeId: string; status: GiftCardCodeStatus }> {
  const parsed = voidGiftCardInputSchema.parse(input);
  await assertTrustedAdminActor(parsed.actor);
  if (parsed.actorUserId && parsed.actorUserId !== parsed.actor.userId) {
    throw giftCardError(giftCardErrorCodes.adminActorForbidden);
  }

  const updated = await prisma.giftCardCode.updateMany({
    where: {
      id: parsed.codeId,
      status: GiftCardCodeStatus.ISSUED,
    },
    data: {
      status: GiftCardCodeStatus.VOIDED,
      voidedById: parsed.actor.userId,
      voidedAt: new Date(),
      voidReason: parsed.reason,
    },
  });

  if (updated.count === 0) {
    throw giftCardError(giftCardErrorCodes.codeNotVoidable);
  }

  await prisma.auditLog.create({
    data: {
      actorId: parsed.actor.userId,
      actionType: "GIFT_CARD_CODE_VOIDED",
      entityType: "GiftCardCode",
      entityId: parsed.codeId,
      metadata: {
        reason: parsed.reason,
        source: "gift-card-code-service",
      },
    },
  });

  return { codeId: parsed.codeId, status: GiftCardCodeStatus.VOIDED };
}

export async function lookupGiftCardCodeForRedemption(plaintextCode: string): Promise<{
  id: string;
  orderId: string | null;
  orderItemId: string | null;
  status: GiftCardCodeStatus;
  amountMinor: number;
  currencyCode: string;
  expiresAt: Date | null;
  purchasedById: string | null;
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
  try {
    const activation = await activateGiftCardValue({
      actor: { type: "USER", userId: input.redeemerUserId, role: Role.CLIENT },
      clientId: input.redeemerClientId,
      orderId: record.orderId ?? undefined,
      orderItemId: record.orderItemId,
      amountMinor: record.amountMinor,
      currencyCode: record.currencyCode,
      idempotencyKey: `redeem:${record.id}`,
      metadata: { source: "gift-card-code-redemption", redeemerUserId: input.redeemerUserId },
      atomicMarkCodeRedeemed: { codeId: record.id, redeemerUserId: input.redeemerUserId },
    });

    return {
      newBalanceMinor: activation.wallet.balanceMinor,
      currencyCode: activation.wallet.currencyCode,
      amountRedeemedMinor: record.amountMinor,
    };
  } catch (walletError) {
    if (
      walletError instanceof GiftCardIdempotencyConflictError ||
      (walletError instanceof GiftCardError &&
        walletError.code === giftCardErrorCodes.giftCardCodeConcurrentRedemption)
    ) {
      throw genericError;
    }
    console.error("[gift-card-code] wallet activation failed during redemption", walletError instanceof Error ? walletError.message : String(walletError));
    throw new GiftCardCodeRedemptionError("WALLET_ERROR", "Gift card redemption could not be completed. Please try again.");
  }
}

export type GiftCardCodeResendResult =
  | { outcome: "sent"; maskedCode: string }
  | { outcome: "already_redeemed" }
  | { outcome: "not_resendable"; reason: "voided" | "expired" };

export class GiftCardCodeResendError extends Error {
  constructor(
    readonly errorCode: "OWNERSHIP_DENIED" | "NOT_FOUND" | "EMAIL_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "GiftCardCodeResendError";
  }
}

/**
 * Rotates the gift card code for an ISSUED (unredeemed) code owned by requestedById
 * and resends it via email. The old code is replaced server-side so the previous
 * value can no longer be redeemed. Plaintext is never written to the database.
 */
export async function requestGiftCardCodeResend(input: {
  orderItemId: string;
  requestedById: string;
}): Promise<GiftCardCodeResendResult> {
  const record = await prisma.giftCardCode.findUnique({
    where: { orderItemId: input.orderItemId },
    select: {
      id: true,
      orderId: true,
      purchasedById: true,
      status: true,
      amountMinor: true,
      currencyCode: true,
      expiresAt: true,
    },
  });

  if (!record) {
    throw new GiftCardCodeResendError("NOT_FOUND", "Gift card code not found.");
  }

  // Ownership validation — server-side, always enforced
  if (record.purchasedById !== input.requestedById) {
    throw new GiftCardCodeResendError("OWNERSHIP_DENIED", "You do not own this gift card code.");
  }

  if (record.status === GiftCardCodeStatus.REDEEMED) {
    return { outcome: "already_redeemed" };
  }

  if (record.status === GiftCardCodeStatus.VOIDED) {
    return { outcome: "not_resendable", reason: "voided" };
  }

  if (
    record.status === GiftCardCodeStatus.EXPIRED ||
    (record.expiresAt !== null && record.expiresAt < new Date())
  ) {
    return { outcome: "not_resendable", reason: "expired" };
  }

  // Generate a fresh code. The old code hash is replaced, invalidating the previous value.
  const newPlaintextCode = generatePlaintextCode();
  const newCodeHash = hashCode(newPlaintextCode);
  const newMaskedCode = maskCode(newPlaintextCode);

  await prisma.$transaction(async (tx) => {
    await tx.giftCardCode.update({
      where: { orderItemId: input.orderItemId },
      data: {
        codeHash: newCodeHash,
        maskedCode: newMaskedCode,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.requestedById,
        actionType: "GIFT_CARD_CODE_RESENT",
        entityType: "GiftCardCode",
        entityId: record.id,
        metadata: {
          orderId: record.orderId,
          orderItemId: input.orderItemId,
          maskedCode: newMaskedCode,
          source: "gift-card-code-service",
        },
      },
    });
  });

  const purchaser = await prisma.user.findUnique({
    where: { id: input.requestedById },
    select: { name: true, email: true },
  });

  if (!purchaser?.email) {
    throw new GiftCardCodeResendError("EMAIL_MISSING", "No email address on file.");
  }

  const { sendGiftCardIssuanceEmail } = await import("@/lib/email/gift-card-email");
  await sendGiftCardIssuanceEmail({
    to: purchaser.email,
    purchaserName: purchaser.name,
    plaintextCode: newPlaintextCode,
    amountMinor: record.amountMinor,
    currencyCode: record.currencyCode ?? GIFT_CARD_CURRENCY_CODE,
  });

  return { outcome: "sent", maskedCode: newMaskedCode };
}
