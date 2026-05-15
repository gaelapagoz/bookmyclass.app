import {
  CartCheckoutIdempotencyState,
  CartCheckoutResponseType as PrismaCartCheckoutResponseType,
  CheckoutSource,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  ProductType,
  Role,
  UserActivationStatus,
} from "@prisma/client";
import {
  CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR,
  CART_CHECKOUT_IDEMPOTENCY_STATES,
  CART_CHECKOUT_RESPONSE_TYPES,
  CART_CHECKOUT_SOURCE,
} from "@/lib/cart/cart-contract";
import type { CartLineInput, CartValidationResult } from "@/lib/cart/cart-types";
import { computeCartHash } from "@/lib/cart/cart-hash";
import { validateCart } from "@/lib/cart/cart-service";
import { prisma } from "@/lib/db";
import {
  createStripeCheckoutSessionWithIdempotency,
  getStripeServerEnv,
} from "@/lib/payments/stripe";
import { isCatalogPriceCheckoutReady } from "@/lib/catalog/checkout-readiness";
import { checkAndRecordDbRateLimit } from "@/lib/security/db-rate-limit";
import {
  captureGiftCardRedemption,
  reserveGiftCardValue,
} from "@/lib/gift-cards/gift-card-wallet-service";
import { GIFT_CARD_CURRENCY_CODE } from "@/lib/gift-cards/gift-card-types";
import { GiftCardError, giftCardErrorCodes } from "@/lib/gift-cards/gift-card-errors";
import { fulfillPaidCartOrder } from "@/lib/fulfillment/order-fulfillment-service";

const GIFT_CARD_CHECKOUT_RATE_LIMIT = {
  maxAttempts: 10,
  windowMs: 10 * 60 * 1000,
} as const;

const GIFT_CARD_REDEMPTION_RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000,
} as const;

const RETRY_AFTER_MS = 1500;
const STALE_IN_PROGRESS_MS = 30_000;
const LONG_LIVED_UNCERTAIN_MS = 15_000;
const CART_CHECKOUT_DEBUG = process.env.CART_CHECKOUT_DEBUG === "1";

type CartCheckoutResponse = {
  status: number;
  body: Record<string, unknown>;
};

type IdempotencyAcquireResult =
  | {
      kind: "created";
      record: {
        id: string;
        orderId: string | null;
        paymentId: string | null;
        redemptionId: string | null;
        giftCardPaymentId: string | null;
        stripePaymentId: string | null;
        stripeRequestPayload: Prisma.JsonValue | null;
      };
    }
  | { kind: "conflict"; record: { state: CartCheckoutIdempotencyState } }
  | { kind: "inProgress"; record: { state: CartCheckoutIdempotencyState } }
  | { kind: "replay"; record: { responseStatus: number | null; responseBody: Prisma.JsonValue | null } }
  | {
      kind: "failed";
      record: {
        id: string;
        state: CartCheckoutIdempotencyState;
        orderId: string | null;
        paymentId: string | null;
        redemptionId: string | null;
        giftCardPaymentId: string | null;
        stripePaymentId: string | null;
        stripeRequestPayload: Prisma.JsonValue | null;
        responseStatus: number | null;
        responseBody: Prisma.JsonValue | null;
        createdAt: Date;
        updatedAt: Date;
      };
    };

type CartCheckoutStartInput = {
  userId: string;
  idempotencyKey: string;
  lines: CartLineInput[];
  clientCartVersion: string;
  walletAmountMinor?: number;
};

type CartCheckoutPaymentRefs = {
  orderId: string;
  paymentId: string;
  stripePaymentId: string | null;
  giftCardPaymentId: string | null;
  redemptionId: string | null;
  stripeAmountMinor: number;
};

function debugLog(event: string, payload: Record<string, unknown>) {
  if (!CART_CHECKOUT_DEBUG) {
    return;
  }
  try {
    console.info(`[cart-checkout-debug] ${event} ${JSON.stringify(payload)}`);
  } catch {
    console.info(`[cart-checkout-debug] ${event}`, payload);
  }
}

function summarizeStripeParamsForDebug(params: Record<string, unknown>) {
  const mode = typeof params.mode === "string" ? params.mode : null;
  const clientReferenceId =
    typeof params.client_reference_id === "string" ? params.client_reference_id : null;
  const successUrl = typeof params.success_url === "string" ? params.success_url : null;
  const cancelUrl = typeof params.cancel_url === "string" ? params.cancel_url : null;
  const lineItems = Array.isArray(params.line_items)
    ? params.line_items
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const asRecord = item as Record<string, unknown>;
          return {
            price: typeof asRecord.price === "string" ? asRecord.price : null,
            quantity: typeof asRecord.quantity === "number" ? asRecord.quantity : null,
          };
        })
        .filter((item): item is { price: string | null; quantity: number | null } => item !== null)
    : [];

  return {
    mode,
    clientReferenceId,
    successUrl,
    cancelUrl,
    lineItems,
    lineItemCount: lineItems.length,
  };
}

function extractStripeErrorDetails(error: unknown) {
  if (!error || typeof error !== "object") {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : null,
    };
  }

  const asRecord = error as Record<string, unknown>;
  const raw =
    asRecord.raw && typeof asRecord.raw === "object" ? (asRecord.raw as Record<string, unknown>) : null;

  return {
    name: typeof asRecord.name === "string" ? asRecord.name : null,
    message:
      typeof asRecord.message === "string"
        ? asRecord.message
        : error instanceof Error
          ? error.message
          : null,
    type: typeof asRecord.type === "string" ? asRecord.type : null,
    code: typeof asRecord.code === "string" ? asRecord.code : null,
    param: typeof asRecord.param === "string" ? asRecord.param : null,
    requestId: typeof asRecord.requestId === "string" ? asRecord.requestId : null,
    statusCode: typeof asRecord.statusCode === "number" ? asRecord.statusCode : null,
    rawType: raw && typeof raw.type === "string" ? raw.type : null,
    rawCode: raw && typeof raw.code === "string" ? raw.code : null,
    rawParam: raw && typeof raw.param === "string" ? raw.param : null,
    rawMessage: raw && typeof raw.message === "string" ? raw.message : null,
    rawRequestLogUrl:
      raw && typeof raw.request_log_url === "string" ? raw.request_log_url : null,
  };
}

function isDeterministicStripeRequestError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const asRecord = error as Record<string, unknown>;
  const statusCode = typeof asRecord.statusCode === "number" ? asRecord.statusCode : null;
  const type = typeof asRecord.type === "string" ? asRecord.type : null;
  const name = typeof asRecord.name === "string" ? asRecord.name : null;
  const raw =
    asRecord.raw && typeof asRecord.raw === "object" ? (asRecord.raw as Record<string, unknown>) : null;
  const rawType = raw && typeof raw.type === "string" ? raw.type : null;

  const invalidRequestType =
    type === "StripeInvalidRequestError" ||
    name === "StripeInvalidRequestError" ||
    rawType === "invalid_request_error";

  if (invalidRequestType) {
    return true;
  }

  if (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return true;
  }

  return false;
}

const COMPOSITION_REJECTION_CODES = new Set([
  "MIXED_PRICE_TYPES_NOT_ALLOWED",
  "ACTIVE_SUBSCRIPTION_ALREADY_EXISTS",
]);

function withIdempotency(input: {
  key: string;
  state: CartCheckoutIdempotencyState;
  replayed: boolean;
}) {
  return {
    key: input.key,
    state: input.state,
    replayed: input.replayed,
  };
}

function createInProgressResponse(input: {
  key: string;
  state: CartCheckoutIdempotencyState;
  replayed: boolean;
}): CartCheckoutResponse {
  return {
    status: 202,
    body: {
      status: "IDEMPOTENCY_IN_PROGRESS",
      code: "IDEMPOTENCY_IN_PROGRESS",
      message: "Checkout request is being processed.",
      retryAfterMs: RETRY_AFTER_MS,
      idempotency: withIdempotency(input),
    },
  };
}

function isStale(updatedAt: Date, maxAgeMs: number): boolean {
  return Date.now() - updatedAt.getTime() >= maxAgeMs;
}

function createErrorResponse(input: {
  status: number;
  code: string;
  message: string;
  idempotency?: {
    key: string;
    state: CartCheckoutIdempotencyState;
    replayed: boolean;
  };
}): CartCheckoutResponse {
  return {
    status: input.status,
    body: {
      code: input.code,
      message: input.message,
      ...(input.idempotency ? { idempotency: withIdempotency(input.idempotency) } : {}),
    },
  };
}

function createSuccessResponse(input: {
  key: string;
  replayed: boolean;
  orderId: string;
  paymentId: string;
  checkoutSessionId: string;
  checkoutUrl: string;
}): CartCheckoutResponse {
  return {
    status: 200,
    body: {
      type: CART_CHECKOUT_RESPONSE_TYPES.STRIPE_REDIRECT,
      status: "CHECKOUT_SESSION_CREATED",
      orderId: input.orderId,
      paymentId: input.paymentId,
      checkoutSessionId: input.checkoutSessionId,
      checkoutUrl: input.checkoutUrl,
      idempotency: withIdempotency({
        key: input.key,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
        replayed: input.replayed,
      }),
    },
  };
}

function createCompletedResponse(input: {
  key: string;
  replayed: boolean;
  orderId: string;
  giftCardPaymentId: string;
}): CartCheckoutResponse {
  return {
    status: 200,
    body: {
      type: CART_CHECKOUT_RESPONSE_TYPES.COMPLETED,
      status: "CHECKOUT_COMPLETED",
      orderId: input.orderId,
      paymentMethod: PaymentMethod.GIFT_CARD,
      redirectUrl: `/store/success?orderId=${encodeURIComponent(input.orderId)}`,
      paymentId: input.giftCardPaymentId,
      idempotency: withIdempotency({
        key: input.key,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
        replayed: input.replayed,
      }),
    },
  };
}

async function isEligibleCheckoutClient(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      activationStatus: true,
      emailVerified: true,
    },
  });

  return Boolean(
    user &&
      user.role === Role.CLIENT &&
      user.activationStatus === UserActivationStatus.ACTIVE &&
      user.emailVerified,
  );
}

function replayBodyWithReplayFlag(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {};
  }

  const asRecord = body as Record<string, unknown>;
  const idempotency = asRecord.idempotency;
  if (!idempotency || typeof idempotency !== "object" || Array.isArray(idempotency)) {
    return asRecord;
  }

  return {
    ...asRecord,
    idempotency: {
      ...(idempotency as Record<string, unknown>),
      replayed: true,
    },
  };
}

async function persistTerminalResponse(input: {
  id: string;
  response: CartCheckoutResponse;
  giftCardPaymentId?: string | null;
  redemptionId?: string | null;
}) {
  const responseBody = input.response.body as Record<string, unknown>;
  const responseType =
    responseBody.type === CART_CHECKOUT_RESPONSE_TYPES.COMPLETED
      ? PrismaCartCheckoutResponseType.COMPLETED
      : responseBody.type === CART_CHECKOUT_RESPONSE_TYPES.STRIPE_REDIRECT
        ? PrismaCartCheckoutResponseType.STRIPE_REDIRECT
        : undefined;
  debugLog("persist_terminal_response", {
    idempotencyRecordId: input.id,
    responseStatus: input.response.status,
    responseCode: typeof responseBody.code === "string" ? responseBody.code : null,
  });
  await prisma.cartCheckoutIdempotency.update({
    where: { id: input.id },
    data: {
      state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
      responseStatus: input.response.status,
      responseCode: typeof responseBody.code === "string" ? responseBody.code : null,
      responseMessage: typeof responseBody.message === "string" ? responseBody.message : null,
      responseBody: responseBody as Prisma.InputJsonValue,
      ...(responseType ? { responseType } : {}),
      ...(responseType === PrismaCartCheckoutResponseType.STRIPE_REDIRECT
        ? {
            stripePaymentId: typeof responseBody.paymentId === "string" ? responseBody.paymentId : null,
            checkoutSessionId:
              typeof responseBody.checkoutSessionId === "string" ? responseBody.checkoutSessionId : null,
          }
        : {}),
      ...(input.giftCardPaymentId != null ? { giftCardPaymentId: input.giftCardPaymentId } : {}),
      ...(input.redemptionId != null ? { redemptionId: input.redemptionId } : {}),
    },
  });
}

async function acquireIdempotencyRecord(input: {
  userId: string;
  idempotencyKey: string;
  cartHash: string;
}): Promise<IdempotencyAcquireResult> {
  let createdFresh = false;
  let existing = await prisma.cartCheckoutIdempotency.findUnique({
    where: {
      userId_idempotencyKey: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
      cartHash: true,
      state: true,
      orderId: true,
      paymentId: true,
      redemptionId: true,
      giftCardPaymentId: true,
      stripePaymentId: true,
      stripeRequestPayload: true,
      responseStatus: true,
      responseBody: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!existing) {
    try {
      existing = await prisma.cartCheckoutIdempotency.create({
        data: {
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          cartHash: input.cartHash,
          state: CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS,
        },
        select: {
          id: true,
          cartHash: true,
          state: true,
          orderId: true,
          paymentId: true,
          redemptionId: true,
          giftCardPaymentId: true,
          stripePaymentId: true,
          stripeRequestPayload: true,
          responseStatus: true,
          responseBody: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      createdFresh = true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      existing = await prisma.cartCheckoutIdempotency.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: {
          id: true,
          cartHash: true,
          state: true,
          orderId: true,
          paymentId: true,
          redemptionId: true,
          giftCardPaymentId: true,
          stripePaymentId: true,
          stripeRequestPayload: true,
          responseStatus: true,
          responseBody: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    }
  }

  if (!existing) {
    throw new Error("Could not acquire idempotency record.");
  }

  if (existing.cartHash !== input.cartHash) {
    return { kind: "conflict", record: { state: existing.state } };
  }

  if (createdFresh) {
    return {
      kind: "created",
      record: {
        id: existing.id,
        orderId: existing.orderId,
        paymentId: existing.paymentId,
        redemptionId: existing.redemptionId,
        giftCardPaymentId: existing.giftCardPaymentId,
        stripePaymentId: existing.stripePaymentId,
        stripeRequestPayload: existing.stripeRequestPayload,
      },
    };
  }

  if (existing.state === CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS) {
    const isStaleInProgress = isStale(existing.updatedAt, STALE_IN_PROGRESS_MS);
    if (!isStaleInProgress) {
      return { kind: "inProgress", record: { state: existing.state } };
    }

    const recoveredState =
      existing.orderId && existing.paymentId
        ? existing.stripeRequestPayload
          ? CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_STRIPE_UNCERTAIN
          : CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_AFTER_WRITE_PRE_STRIPE
        : CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_BEFORE_WRITE;

    const recovered = await prisma.cartCheckoutIdempotency.updateMany({
      where: {
        id: existing.id,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS,
      },
      data: {
        state: recoveredState,
      },
    });

    if (recovered.count === 0) {
      return { kind: "inProgress", record: { state: CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS } };
    }

    return {
      kind: "failed",
      record: {
        id: existing.id,
        state: recoveredState,
        orderId: existing.orderId,
        paymentId: existing.paymentId,
        redemptionId: existing.redemptionId,
        giftCardPaymentId: existing.giftCardPaymentId,
        stripePaymentId: existing.stripePaymentId,
        stripeRequestPayload: existing.stripeRequestPayload,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      },
    };
  }

  if (existing.state === CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED) {
    return {
      kind: "replay",
      record: {
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
      },
    };
  }

  return {
    kind: "failed",
    record: {
      id: existing.id,
      state: existing.state,
      orderId: existing.orderId,
      paymentId: existing.paymentId,
      redemptionId: existing.redemptionId,
      giftCardPaymentId: existing.giftCardPaymentId,
      stripePaymentId: existing.stripePaymentId,
      stripeRequestPayload: existing.stripeRequestPayload,
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    },
  };
}

async function resolvePriceStripeMap(priceIds: string[]) {
  const prices = await prisma.price.findMany({
    where: { id: { in: priceIds } },
    select: {
      id: true,
      isActive: true,
      isArchived: true,
      priceType: true,
      currencyCode: true,
      unitAmountMinor: true,
      billingInterval: true,
      billingIntervalCount: true,
      stripePriceId: true,
      stripeSyncStatus: true,
      product: {
        select: {
          isActive: true,
          isArchived: true,
        },
      },
    },
  });

  return new Map(
    prices.map((price) => [
      price.id,
      !price.isActive ||
      price.isArchived ||
      !price.product.isActive ||
      price.product.isArchived ||
      !isCatalogPriceCheckoutReady(price)
        ? null
        : price.stripePriceId,
    ]),
  );
}

async function assertCartCheckoutStillEligibleBeforeSession(input: {
  userId: string;
  orderId: string;
  paymentId: string;
}) {
  if (!(await isEligibleCheckoutClient(input.userId))) {
    throw new Error("Checkout actor is no longer eligible.");
  }

  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      orderId: true,
      order: {
        select: {
          clientId: true,
        },
      },
    },
  });

  if (!payment || payment.orderId !== input.orderId || payment.order?.clientId !== input.userId) {
    throw new Error("Cart checkout ownership validation failed.");
  }
}

async function resolveOrCreateOrderPayment(input: {
  userId: string;
  idempotencyRecordId: string;
  existingOrderId: string | null;
  existingPaymentId: string | null;
  existingRedemptionId: string | null;
  existingGiftCardPaymentId: string | null;
  existingStripePaymentId: string | null;
  validation: Extract<CartValidationResult, { ok: true }>;
  walletAmountMinor: number;
}): Promise<CartCheckoutPaymentRefs> {
  try {
    const orderContext = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "CartCheckoutIdempotency"
        WHERE id = ${input.idempotencyRecordId}
        FOR UPDATE
      `;

      const idempotency = await tx.cartCheckoutIdempotency.findUnique({
        where: { id: input.idempotencyRecordId },
        select: {
          orderId: true,
          paymentId: true,
          redemptionId: true,
          giftCardPaymentId: true,
          stripePaymentId: true,
        },
      });

      const existingOrderId = idempotency?.orderId ?? input.existingOrderId;
      const existingStripePaymentId = idempotency?.stripePaymentId ?? input.existingStripePaymentId ?? input.existingPaymentId;
      const existingGiftCardPaymentId = idempotency?.giftCardPaymentId ?? input.existingGiftCardPaymentId;
      const existingRedemptionId = idempotency?.redemptionId ?? input.existingRedemptionId;

      if (existingOrderId) {
        const existingOrder = await tx.order.findFirst({
          where: {
            id: existingOrderId,
            clientId: input.userId,
          },
          select: {
            id: true,
          },
        });

        if (existingOrder) {
          return {
            orderId: existingOrder.id,
            redemptionId: existingRedemptionId,
            giftCardPaymentId: existingGiftCardPaymentId,
            stripePaymentId: existingStripePaymentId,
          };
        }
      }

      const order = await tx.order.create({
        data: {
          clientId: input.userId,
          subtotalAmountMinor: input.validation.pricing.subtotalAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: input.validation.pricing.subtotalAmountMinor,
          currencyCode: input.validation.pricing.currencyCode,
          status: OrderStatus.PLACED,
          notes: "Cart checkout order created from /api/cart/checkout.",
        },
        select: { id: true },
      });

      await tx.orderItem.createMany({
        data: input.validation.repricedLines.map((line) => ({
          orderId: order.id,
          productId: line.productId,
          priceId: line.priceId,
          quantity: line.quantity,
          productNameSnapshot: line.productName,
          priceNameSnapshot: line.priceName,
          unitAmountMinor: line.unitAmountMinor,
          lineSubtotalAmountMinor: line.lineSubtotalAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: line.lineSubtotalAmountMinor,
          currencyCode: line.currencyCode,
        })),
      });

      await tx.cartCheckoutIdempotency.update({
        where: { id: input.idempotencyRecordId },
        data: {
          orderId: order.id,
        },
      });

      return {
        orderId: order.id,
        redemptionId: null,
        giftCardPaymentId: null,
        stripePaymentId: null,
      };
    });

    const walletAmountMinor = input.walletAmountMinor;
    const subtotalAmountMinor = input.validation.pricing.subtotalAmountMinor;
    const stripeAmountMinor = subtotalAmountMinor - walletAmountMinor;

    if (walletAmountMinor <= 0) {
      const stripePaymentId =
        orderContext.stripePaymentId ??
        (
          await prisma.payment.findFirst({
            where: {
              orderId: orderContext.orderId,
              provider: PaymentProvider.STRIPE,
              status: PaymentStatus.PENDING,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        )?.id ??
        (
          await prisma.payment.create({
            data: {
              orderId: orderContext.orderId,
              status: PaymentStatus.PENDING,
              method: PaymentMethod.CARD,
              provider: PaymentProvider.STRIPE,
              amountMinor: subtotalAmountMinor,
              currencyCode: input.validation.pricing.currencyCode,
              checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
            },
            select: { id: true },
          })
        ).id;

      await prisma.cartCheckoutIdempotency.update({
        where: { id: input.idempotencyRecordId },
        data: {
          paymentId: stripePaymentId,
          stripePaymentId,
        },
      });

      return {
        orderId: orderContext.orderId,
        paymentId: stripePaymentId,
        stripePaymentId,
        giftCardPaymentId: null,
        redemptionId: null,
        stripeAmountMinor: subtotalAmountMinor,
      };
    }

    const redemptionId =
      orderContext.redemptionId ??
      (
        await reserveGiftCardValue({
          actor: { type: "USER", userId: input.userId, role: Role.CLIENT },
          clientId: input.userId,
          orderId: orderContext.orderId,
          amountMinor: walletAmountMinor,
          currencyCode: GIFT_CARD_CURRENCY_CODE,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          idempotencyKey: `gift-card:reserve:order:${orderContext.orderId}`,
          metadata: { source: CART_CHECKOUT_SOURCE, idempotencyRecordId: input.idempotencyRecordId },
        })
      ).redemption.id;

    const paymentRefs = await prisma.$transaction(async (tx) => {
      const existingGiftCardPaymentId =
        orderContext.giftCardPaymentId ??
        (
          await tx.payment.findFirst({
            where: {
              orderId: orderContext.orderId,
              provider: PaymentProvider.INTERNAL,
              method: PaymentMethod.GIFT_CARD,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        )?.id;

      const giftCardPaymentId =
        existingGiftCardPaymentId ??
        (
          await tx.payment.create({
            data: {
              orderId: orderContext.orderId,
              status: PaymentStatus.PENDING,
              method: PaymentMethod.GIFT_CARD,
              provider: PaymentProvider.INTERNAL,
              amountMinor: walletAmountMinor,
              currencyCode: input.validation.pricing.currencyCode,
              checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
            },
            select: { id: true },
          })
        ).id;

      const existingStripePaymentId =
        orderContext.stripePaymentId ??
        (
          await tx.payment.findFirst({
            where: {
              orderId: orderContext.orderId,
              provider: PaymentProvider.STRIPE,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          })
        )?.id;

      const stripePaymentId =
        stripeAmountMinor > 0
          ? existingStripePaymentId ??
            (
              await tx.payment.create({
                data: {
                  orderId: orderContext.orderId,
                  status: PaymentStatus.PENDING,
                  method: PaymentMethod.CARD,
                  provider: PaymentProvider.STRIPE,
                  amountMinor: stripeAmountMinor,
                  currencyCode: input.validation.pricing.currencyCode,
                  checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
                },
                select: { id: true },
              })
            ).id
          : null;

      await tx.cartCheckoutIdempotency.update({
        where: { id: input.idempotencyRecordId },
        data: {
          orderId: orderContext.orderId,
          paymentId: stripePaymentId ?? giftCardPaymentId,
          redemptionId,
          giftCardPaymentId,
          stripePaymentId,
        },
      });

      return { giftCardPaymentId, stripePaymentId };
    });

    return {
      orderId: orderContext.orderId,
      paymentId: paymentRefs.stripePaymentId ?? paymentRefs.giftCardPaymentId,
      stripePaymentId: paymentRefs.stripePaymentId,
      giftCardPaymentId: paymentRefs.giftCardPaymentId,
      redemptionId,
      stripeAmountMinor,
    };
  } catch (error) {
    await prisma.cartCheckoutIdempotency.update({
      where: { id: input.idempotencyRecordId },
      data: {
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_BEFORE_WRITE,
      },
    });
    throw error;
  }
}

function mapValidationFailureToResponse(input: {
  key: string;
  validation: Extract<CartValidationResult, { ok: false }>;
}): CartCheckoutResponse {
  const isCompositionBlocked = COMPOSITION_REJECTION_CODES.has(input.validation.rejection.code);
  if (isCompositionBlocked) {
    return createErrorResponse({
      status: 409,
      code: "CART_COMPOSITION_NOT_ALLOWED",
      message: input.validation.rejection.message,
      idempotency: {
        key: input.key,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
        replayed: false,
      },
    });
  }

  return createErrorResponse({
    status: 422,
    code: "CART_VALIDATION_FAILED",
    message: input.validation.rejection.message,
    idempotency: {
      key: input.key,
      state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
      replayed: false,
    },
  });
}

function toReplayResponse(input: {
  responseStatus: number | null;
  responseBody: Prisma.JsonValue | null;
}): CartCheckoutResponse {
  return {
    status: input.responseStatus ?? 200,
    body: replayBodyWithReplayFlag(input.responseBody),
  };
}

export async function resolveDeterministicFailureWithIdempotency(input: {
  userId: string;
  idempotencyKey: string;
  cartHash: string;
  status: number;
  code: string;
  message: string;
}): Promise<CartCheckoutResponse> {
  debugLog("deterministic_failure_start", {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    cartHash: input.cartHash,
    requestedStatus: input.status,
    requestedCode: input.code,
  });
  const acquired = await acquireIdempotencyRecord({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    cartHash: input.cartHash,
  });

  if (acquired.kind === "conflict") {
    debugLog("deterministic_failure_conflict", {
      idempotencyKey: input.idempotencyKey,
      cartHash: input.cartHash,
      existingState: acquired.record.state,
    });
    return createErrorResponse({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key already used for a different cart.",
      idempotency: {
        key: input.idempotencyKey,
        state: acquired.record.state,
        replayed: true,
      },
    });
  }

  if (acquired.kind === "inProgress") {
    debugLog("deterministic_failure_in_progress", {
      idempotencyKey: input.idempotencyKey,
      cartHash: input.cartHash,
      existingState: acquired.record.state,
    });
    return createInProgressResponse({
      key: input.idempotencyKey,
      state: acquired.record.state,
      replayed: true,
    });
  }

  if (acquired.kind === "replay") {
    debugLog("deterministic_failure_replay", {
      idempotencyKey: input.idempotencyKey,
      cartHash: input.cartHash,
      responseStatus: acquired.record.responseStatus,
    });
    return toReplayResponse(acquired.record);
  }

  if (acquired.kind === "failed" && acquired.record.responseBody) {
    debugLog("deterministic_failure_failed_replay", {
      idempotencyKey: input.idempotencyKey,
      cartHash: input.cartHash,
      existingState: acquired.record.state,
      responseStatus: acquired.record.responseStatus,
    });
    return toReplayResponse({
      responseStatus: acquired.record.responseStatus,
      responseBody: acquired.record.responseBody,
    });
  }

  const response = createErrorResponse({
    status: input.status,
    code: input.code,
    message: input.message,
    idempotency: {
      key: input.idempotencyKey,
      state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
      replayed: false,
    },
  });

  const recordId = acquired.record.id;
  debugLog("deterministic_failure_persist", {
    idempotencyKey: input.idempotencyKey,
    cartHash: input.cartHash,
    idempotencyRecordId: recordId,
    responseStatus: response.status,
    responseCode: response.body.code,
  });
  await prisma.cartCheckoutIdempotency.update({
    where: { id: recordId },
    data: {
      state: CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS,
      responseStatus: null,
      responseCode: null,
      responseMessage: null,
      responseBody: Prisma.JsonNull,
    },
  });
  await persistTerminalResponse({
    id: recordId,
    response,
  });
  return response;
}

function buildWalletAugmentedCartHash(cartHash: string, walletAmountMinor: number | undefined): string {
  if (!walletAmountMinor || walletAmountMinor <= 0) {
    return cartHash;
  }
  return `${cartHash}|walletAmountMinor=${walletAmountMinor}`;
}

export async function startCartCheckout(input: CartCheckoutStartInput): Promise<CartCheckoutResponse> {
  const eligibleActor = await isEligibleCheckoutClient(input.userId);
  if (!eligibleActor) {
    const baseCartHash = computeCartHash(input.lines);
    const authFailureHash = `AUTH_FAILURE_V1|cartHash=${buildWalletAugmentedCartHash(baseCartHash, input.walletAmountMinor)}|clientCartVersion=${input.clientCartVersion}`;
    return resolveDeterministicFailureWithIdempotency({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      cartHash: authFailureHash,
      status: 403,
      code: "EMAIL_VERIFICATION_REQUIRED",
      message: "Your account must be active and email-verified before checkout.",
    });
  }

  if ((input.walletAmountMinor ?? 0) > CART_CHECKOUT_MAX_WALLET_AMOUNT_MINOR) {
    const baseCartHash = computeCartHash(input.lines);
    return resolveDeterministicFailureWithIdempotency({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      cartHash: buildWalletAugmentedCartHash(baseCartHash, input.walletAmountMinor),
      status: 422,
      code: "WALLET_REDEMPTION_EXCEEDS_MAX",
      message: "Wallet redemption cannot exceed 500 EUR per order.",
    });
  }

  const validation = await validateCart({
    lines: input.lines,
    clientId: input.userId,
  });

  const effectiveCartHash = buildWalletAugmentedCartHash(validation.cartHash, input.walletAmountMinor);

  debugLog("start_checkout_attempt", {
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    cartHash: effectiveCartHash,
    lineCount: input.lines.length,
    clientCartVersion: input.clientCartVersion,
    validationOk: validation.ok,
    walletAmountMinor: input.walletAmountMinor ?? 0,
  });

  const acquired = await acquireIdempotencyRecord({
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    cartHash: effectiveCartHash,
  });

  if (acquired.kind === "conflict") {
    debugLog("branch_conflict", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      existingState: acquired.record.state,
      branch: "conflict",
      finalStatus: 409,
      finalCode: "IDEMPOTENCY_CONFLICT",
    });
    return createErrorResponse({
      status: 409,
      code: "IDEMPOTENCY_CONFLICT",
      message: "Idempotency key already used for a different cart.",
      idempotency: {
        key: input.idempotencyKey,
        state: acquired.record.state,
        replayed: true,
      },
    });
  }

  if (acquired.kind === "inProgress") {
    debugLog("branch_in_progress", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      existingState: acquired.record.state,
      branch: "in_progress",
      finalStatus: 202,
      finalCode: "IDEMPOTENCY_IN_PROGRESS",
    });
    return createInProgressResponse({
      key: input.idempotencyKey,
      state: acquired.record.state,
      replayed: true,
    });
  }

  if (acquired.kind === "replay") {
    debugLog("branch_replay", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      branch: "replay",
      replayed: true,
      responseStatus: acquired.record.responseStatus,
    });
    return toReplayResponse(acquired.record);
  }

  const idempotencyRecordId = acquired.record.id;
  const resumedFailedRecord = acquired.kind === "failed" ? acquired.record : null;
  debugLog("acquire_result", {
    idempotencyKey: input.idempotencyKey,
    cartHash: validation.cartHash,
    kind: acquired.kind,
    existingState: resumedFailedRecord?.state ?? "IN_PROGRESS_NEW",
    idempotencyRecordId,
    orderId: resumedFailedRecord?.orderId ?? acquired.record.orderId ?? null,
    paymentId: resumedFailedRecord?.paymentId ?? acquired.record.paymentId ?? null,
  });
  if (resumedFailedRecord) {
    const claimed = await prisma.cartCheckoutIdempotency.updateMany({
      where: {
        id: idempotencyRecordId,
        state: resumedFailedRecord.state,
      },
      data: {
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS,
        responseStatus: null,
        responseCode: null,
        responseMessage: null,
        responseBody: Prisma.JsonNull,
      },
    });

    if (claimed.count === 0) {
      debugLog("resume_claim_failed", {
        idempotencyKey: input.idempotencyKey,
        cartHash: effectiveCartHash,
        previousState: resumedFailedRecord.state,
        claimedCount: claimed.count,
      });
      const latest = await acquireIdempotencyRecord({
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        cartHash: effectiveCartHash,
      });

      if (latest.kind === "replay") {
        debugLog("resume_claim_failed_latest_replay", {
          idempotencyKey: input.idempotencyKey,
          cartHash: effectiveCartHash,
          responseStatus: latest.record.responseStatus,
        });
        return toReplayResponse(latest.record);
      }

      if (latest.kind === "conflict") {
        debugLog("resume_claim_failed_latest_conflict", {
          idempotencyKey: input.idempotencyKey,
          cartHash: effectiveCartHash,
          existingState: latest.record.state,
        });
        return createErrorResponse({
          status: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key already used for a different cart.",
          idempotency: {
            key: input.idempotencyKey,
            state: latest.record.state,
            replayed: true,
          },
        });
      }

      return createInProgressResponse({
        key: input.idempotencyKey,
        state:
          latest.kind === "inProgress"
            ? latest.record.state
            : CART_CHECKOUT_IDEMPOTENCY_STATES.IN_PROGRESS,
        replayed: true,
      });
    }
    debugLog("resume_claimed", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      previousState: resumedFailedRecord.state,
      claimedCount: claimed.count,
    });
  }

  if (!validation.ok) {
    const rejectionResponse = mapValidationFailureToResponse({
      key: input.idempotencyKey,
      validation,
    });

    await persistTerminalResponse({
      id: idempotencyRecordId,
      response: rejectionResponse,
    });
    debugLog("branch_validation_failure", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      branch: "validation_failure",
      finalStatus: rejectionResponse.status,
      finalCode: rejectionResponse.body.code,
    });

    return rejectionResponse;
  }

  const cartHasStoreItems = validation.repricedLines.some(
    (line) =>
      line.productType === ProductType.GIFT_CARD || line.productType === ProductType.MERCHANDISE,
  );
  const cartHasGiftCardItems = validation.repricedLines.some(
    (line) => line.productType === ProductType.GIFT_CARD,
  );
  const isRedemptionRequest = (input.walletAmountMinor ?? 0) > 0;
  // Wallet is safe only for one-time payments; recurring renewals are Stripe-backed only.
  const cartIsOneTimeOnly = validation.composition === "ONE_TIME_ONLY";

  // Checked after idempotency replay so stored terminal responses remain replayable.
  if (cartHasGiftCardItems) {
    const gcRateLimit = await checkAndRecordDbRateLimit(
      "gift_card_checkout",
      input.userId,
      GIFT_CARD_CHECKOUT_RATE_LIMIT,
    );
    if (!gcRateLimit.allowed) {
      return {
        status: 429,
        body: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many gift-card checkout attempts. Please wait.",
        },
      };
    }
  }

  if (isRedemptionRequest) {
    const redemptionRateLimit = await checkAndRecordDbRateLimit(
      "gift_card_redemption",
      input.userId,
      GIFT_CARD_REDEMPTION_RATE_LIMIT,
    );
    if (!redemptionRateLimit.allowed) {
      return {
        status: 429,
        body: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many wallet redemption attempts. Please wait.",
        },
      };
    }
  }

  if (isRedemptionRequest && !cartIsOneTimeOnly) {
    const redemptionScopeResponse = createErrorResponse({
      status: 422,
      code: "WALLET_REDEMPTION_REQUIRES_ONE_TIME_CART",
      message: "Gift-card wallet cannot be used for recurring membership purchases.",
      idempotency: {
        key: input.idempotencyKey,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
        replayed: false,
      },
    });
    await persistTerminalResponse({ id: idempotencyRecordId, response: redemptionScopeResponse });
    return redemptionScopeResponse;
  }

  if (isRedemptionRequest && validation.ok && (input.walletAmountMinor ?? 0) > validation.pricing.subtotalAmountMinor) {
    const redemptionExceedsOrderResponse = createErrorResponse({
      status: 422,
      code: "WALLET_REDEMPTION_EXCEEDS_ORDER_TOTAL",
      message: "Wallet redemption cannot exceed the order total.",
      idempotency: {
        key: input.idempotencyKey,
        state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
        replayed: false,
      },
    });
    await persistTerminalResponse({
      id: idempotencyRecordId,
      response: redemptionExceedsOrderResponse,
    });
    return redemptionExceedsOrderResponse;
  }

  let orderPayment: CartCheckoutPaymentRefs;
  try {
    orderPayment = await resolveOrCreateOrderPayment({
      userId: input.userId,
      idempotencyRecordId,
      existingOrderId: resumedFailedRecord?.orderId ?? acquired.record.orderId,
      existingPaymentId: resumedFailedRecord?.paymentId ?? acquired.record.paymentId,
      existingRedemptionId: resumedFailedRecord?.redemptionId ?? acquired.record.redemptionId,
      existingGiftCardPaymentId: resumedFailedRecord?.giftCardPaymentId ?? acquired.record.giftCardPaymentId,
      existingStripePaymentId: resumedFailedRecord?.stripePaymentId ?? acquired.record.stripePaymentId,
      validation,
      walletAmountMinor: input.walletAmountMinor ?? 0,
    });
  } catch (error) {
    if (error instanceof GiftCardError) {
      const code =
        error.code === giftCardErrorCodes.insufficientAvailableBalance
          ? "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE"
          : error.code;
      const walletFailureResponse = createErrorResponse({
        status: 422,
        code,
        message: "Gift-card wallet redemption could not be applied.",
        idempotency: {
          key: input.idempotencyKey,
          state: CART_CHECKOUT_IDEMPOTENCY_STATES.SUCCEEDED,
          replayed: false,
        },
      });
      await persistTerminalResponse({
        id: idempotencyRecordId,
        response: walletFailureResponse,
      });
      return walletFailureResponse;
    }
    throw error;
  }

  if (orderPayment.stripeAmountMinor === 0) {
    if (!orderPayment.redemptionId || !orderPayment.giftCardPaymentId) {
      throw new Error("Full wallet checkout is missing gift-card payment references.");
    }

    await captureGiftCardRedemption({
      actor: { type: "USER", userId: input.userId, role: Role.CLIENT },
      redemptionId: orderPayment.redemptionId,
      paymentId: orderPayment.giftCardPaymentId,
      idempotencyKey: `gift-card:capture:redemption:${orderPayment.redemptionId}`,
      metadata: { source: CART_CHECKOUT_SOURCE, idempotencyRecordId },
    });

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: orderPayment.giftCardPaymentId! },
        data: {
          status: PaymentStatus.SUCCEEDED,
          capturedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: orderPayment.orderId },
        data: { status: OrderStatus.PAID },
      });
    });

    await fulfillPaidCartOrder({
      orderId: orderPayment.orderId,
      clientId: input.userId,
      giftCardPaymentId: orderPayment.giftCardPaymentId ?? undefined,
    });

    const completedResponse = createCompletedResponse({
      key: input.idempotencyKey,
      replayed: false,
      orderId: orderPayment.orderId,
      giftCardPaymentId: orderPayment.giftCardPaymentId,
    });

    await persistTerminalResponse({
      id: idempotencyRecordId,
      response: completedResponse,
      giftCardPaymentId: orderPayment.giftCardPaymentId,
      redemptionId: orderPayment.redemptionId,
    });

    return completedResponse;
  }

  let stripeAttempted = false;

  try {
    const env = getStripeServerEnv();
    await assertCartCheckoutStillEligibleBeforeSession({
      userId: input.userId,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.stripePaymentId ?? orderPayment.paymentId,
    });
    const metadata = {
      source: CART_CHECKOUT_SOURCE,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      redemptionId: orderPayment.redemptionId ?? "",
      giftCardPaymentId: orderPayment.giftCardPaymentId ?? "",
    };

    let stripeParams: Prisma.JsonObject | null = resumedFailedRecord?.stripeRequestPayload as Prisma.JsonObject | null;
    if (!stripeParams) {
      const stripePriceIdsByLocalPriceId = await resolvePriceStripeMap(
        validation.repricedLines.map((line) => line.priceId),
      );

      const stripeLineItems =
        (input.walletAmountMinor ?? 0) > 0
          ? [
              {
                price_data: {
                  currency: validation.pricing.currencyCode.toLowerCase(),
                  product_data: {
                    name: "Store checkout remaining balance",
                  },
                  unit_amount: orderPayment.stripeAmountMinor,
              },
              quantity: 1,
            },
          ]
          : cartHasStoreItems
            ? validation.repricedLines.map((line) => ({
                price_data: {
                  currency: line.currencyCode.toLowerCase(),
                  product_data: {
                    name: line.productName,
                    description: line.productDescription ?? undefined,
                  },
                  unit_amount: line.unitAmountMinor,
                },
                quantity: line.quantity,
              }))
          : validation.repricedLines.map((line) => {
              const stripePriceId = stripePriceIdsByLocalPriceId.get(line.priceId);
              if (!stripePriceId) {
                throw new Error(`Missing Stripe price for priceId ${line.priceId}.`);
              }

              return {
                price: stripePriceId,
                quantity: line.quantity,
              };
            });

      stripeParams = {
        mode: validation.composition === "RECURRING_ONLY" ? "subscription" : "payment",
        line_items: stripeLineItems as unknown as Prisma.JsonArray,
        metadata: metadata as unknown as Prisma.JsonObject,
        client_reference_id: input.userId,
        success_url: cartHasStoreItems
          ? `${env.appUrl}/store/success?session_id={CHECKOUT_SESSION_ID}`
          : `${env.appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cartHasStoreItems
          ? `${env.appUrl}/cart`
          : `${env.appUrl}/subscription/cancel`,
      };
      if (validation.composition === "RECURRING_ONLY") {
        stripeParams.subscription_data = { metadata } as unknown as Prisma.JsonObject;
      }

      await prisma.cartCheckoutIdempotency.update({
        where: { id: idempotencyRecordId },
        data: {
          stripeRequestPayload: stripeParams,
        },
      });
    }

    if (process.env.E2E_TEST_MODE === "1") {
      const syntheticCheckoutSessionId = `cs_e2e_${Date.now()}_${orderPayment.paymentId.slice(-8)}`;
      const syntheticCheckoutUrl = cartHasStoreItems
        ? `${env.appUrl}/store/success?session_id=${encodeURIComponent(syntheticCheckoutSessionId)}`
        : `${env.appUrl}/subscription/success?session_id=${encodeURIComponent(syntheticCheckoutSessionId)}`;

      await prisma.payment.update({
        where: { id: orderPayment.stripePaymentId ?? orderPayment.paymentId },
        data: {
          providerReference: syntheticCheckoutSessionId,
          stripeCheckoutSessionId: syntheticCheckoutSessionId,
          stripeCheckoutMode: validation.composition === "RECURRING_ONLY" ? "SUBSCRIPTION" : "PAYMENT",
        },
      });

      const syntheticSuccessResponse = createSuccessResponse({
        key: input.idempotencyKey,
        replayed: false,
        orderId: orderPayment.orderId,
        paymentId: orderPayment.paymentId,
        checkoutSessionId: syntheticCheckoutSessionId,
        checkoutUrl: syntheticCheckoutUrl,
      });

      await persistTerminalResponse({
        id: idempotencyRecordId,
        response: syntheticSuccessResponse,
      });

      return syntheticSuccessResponse;
    }

    stripeAttempted = true;
    debugLog("stripe_call_params", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      params: summarizeStripeParamsForDebug(stripeParams as unknown as Record<string, unknown>),
    });
    debugLog("stripe_call_start", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      stripeStarted: true,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
    });
    const checkoutSession = await createStripeCheckoutSessionWithIdempotency({
      idempotencyKey: input.idempotencyKey,
      params: stripeParams as unknown as Record<string, unknown>,
    });

    if (!checkoutSession.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    debugLog("stripe_call_success", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      stripeStarted: true,
      stripeOutcome: "succeeded",
      checkoutSessionId: checkoutSession.id,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
    });

    await prisma.payment.update({
      where: { id: orderPayment.stripePaymentId ?? orderPayment.paymentId },
      data: {
        providerReference: checkoutSession.id,
        stripeCheckoutSessionId: checkoutSession.id,
        stripeCheckoutMode: validation.composition === "RECURRING_ONLY" ? "SUBSCRIPTION" : "PAYMENT",
      },
    });

    const successResponse = createSuccessResponse({
      key: input.idempotencyKey,
      replayed: false,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
      checkoutSessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
    });

    await persistTerminalResponse({
      id: idempotencyRecordId,
      response: successResponse,
    });
    debugLog("branch_success", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      branch: "success",
      finalStatus: successResponse.status,
      finalCode: successResponse.body.status,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
    });

    return successResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start checkout.";
    const loweredMessage = message.toLowerCase();
    const timeoutLike =
      loweredMessage.includes("timeout") ||
      loweredMessage.includes("timed out") ||
      loweredMessage.includes("etimedout");

    const deterministicStripeRequestError = isDeterministicStripeRequestError(error);
    const state = !stripeAttempted || message.startsWith("Missing Stripe price") || deterministicStripeRequestError
      ? CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_AFTER_WRITE_PRE_STRIPE
      : CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_STRIPE_UNCERTAIN;

    await prisma.cartCheckoutIdempotency.update({
      where: { id: idempotencyRecordId },
      data: {
        state,
        orderId: orderPayment.orderId,
        paymentId: orderPayment.paymentId,
      },
    });
    debugLog("stripe_call_failure", {
      idempotencyKey: input.idempotencyKey,
      cartHash: effectiveCartHash,
      stripeStarted: stripeAttempted,
      stripeOutcome: timeoutLike ? "timed_out" : "failed",
      errorMessage: message,
      deterministicStripeRequestError,
      stripeError: extractStripeErrorDetails(error),
      nextState: state,
      orderId: orderPayment.orderId,
      paymentId: orderPayment.paymentId,
    });

    if (state === CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_STRIPE_UNCERTAIN) {
      const repeatedUncertainFailure =
        resumedFailedRecord?.state === CART_CHECKOUT_IDEMPOTENCY_STATES.FAILED_STRIPE_UNCERTAIN;
      const longLivedUncertain =
        repeatedUncertainFailure &&
        isStale(resumedFailedRecord.updatedAt, LONG_LIVED_UNCERTAIN_MS);
      if (repeatedUncertainFailure || longLivedUncertain) {
        const deterministicFailureResponse = createErrorResponse({
          status: 500,
          code: "CHECKOUT_CREATE_FAILED",
          message: "Checkout could not be confirmed yet. Please retry shortly.",
          idempotency: {
            key: input.idempotencyKey,
            state,
            replayed: false,
          },
        });

        await persistTerminalResponse({
          id: idempotencyRecordId,
          response: deterministicFailureResponse,
        });
        debugLog("branch_long_lived_uncertain_escalated", {
          idempotencyKey: input.idempotencyKey,
          cartHash: effectiveCartHash,
          branch: "long_lived_uncertain_escalated",
          finalStatus: deterministicFailureResponse.status,
          finalCode: deterministicFailureResponse.body.code,
          orderId: orderPayment.orderId,
          paymentId: orderPayment.paymentId,
        });

        return deterministicFailureResponse;
      }

      debugLog("branch_failed_uncertain_in_progress", {
        idempotencyKey: input.idempotencyKey,
        cartHash: effectiveCartHash,
        branch: "failed_uncertain_in_progress",
        finalStatus: 202,
        finalCode: "IDEMPOTENCY_IN_PROGRESS",
        orderId: orderPayment.orderId,
        paymentId: orderPayment.paymentId,
      });
      return createInProgressResponse({
        key: input.idempotencyKey,
        state,
        replayed: false,
      });
    }

    return createErrorResponse({
      status: 500,
      code: "CHECKOUT_CREATE_FAILED",
      message: "Could not start checkout.",
      idempotency: {
        key: input.idempotencyKey,
        state,
        replayed: false,
      },
    });
  }
}
