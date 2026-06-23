import "./helpers/setup-env";

import {
  BookingPaymentSelection,
  BookingStatus,
  BillingInterval,
  CreditLedgerEntryType,
  CouponDiscountType,
  CouponRedemptionStatus,
  CouponStatus,
  EntitlementScope,
  EntitlementType,
  GiftCardReconciliationStatus,
  GiftCardRedemptionStatus,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createStripeCheckoutSessionWithIdempotencyMock = vi.fn();
const getStripeServerEnvMock = vi.fn(() => ({
  appUrl: "http://localhost:3000",
  secretKey: "sk_test_123",
  webhookSecret: "whsec_123",
}));

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

vi.mock("../../src/lib/payments/stripe", () => ({
  getStripeServerEnv: () => getStripeServerEnvMock(),
  getStripePublicEnv: () => ({
    publishableKey: "pk_test_123",
  }),
  createStripeCheckoutSessionWithIdempotency: (...args: unknown[]) =>
    createStripeCheckoutSessionWithIdempotencyMock(...args),
}));

import { auth } from "../../src/auth";
import { POST as cartCheckoutRoute } from "../../src/app/api/cart/checkout/route";
import { GET as cartSuccessValidateRoute } from "../../src/app/api/cart/success/validate/route";
import { startCartCheckout } from "../../src/lib/cart/cart-checkout-service";
import * as checkoutFinalizationService from "../../src/lib/public-booking/checkout-finalization-service";
import * as couponValidationService from "../../src/lib/coupons/coupon-validation-service";
import { reserveCouponRedemptionForCartCheckout } from "../../src/lib/coupons/coupon-validation-service";
import { computeCartHash as computeHash } from "../../src/lib/cart/cart-hash";
import { validateCart } from "../../src/lib/cart/cart-service";
import { hashRateLimitKey } from "../../src/lib/security/db-rate-limit";
import { processStripeWebhookEvent } from "../../src/lib/public-booking/stripe-webhook-service";
import { captureGiftCardRedemption } from "../../src/lib/gift-cards/gift-card-wallet-service";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/cart",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

function createRequest(input: {
  key?: string;
  body: object;
  headers?: Record<string, string>;
}) {
  return new Request("http://localhost/api/cart/checkout", {
    method: "POST",
    headers: {
      ...sameOriginHeaders,
      ...(input.key ? { "Idempotency-Key": input.key } : {}),
      ...(input.headers ?? {}),
    },
    body: JSON.stringify(input.body),
  });
}

function createRawRequest(input: {
  key?: string;
  rawBody: string;
  headers?: Record<string, string>;
}) {
  return new Request("http://localhost/api/cart/checkout", {
    method: "POST",
    headers: {
      ...sameOriginHeaders,
      ...(input.key ? { "Idempotency-Key": input.key } : {}),
      ...(input.headers ?? {}),
    },
    body: input.rawBody,
  });
}

async function seedClient(input: { verified: boolean }) {
  return prisma.user.create({
    data: {
      name: "Client",
      email: `client.sliceb.${Date.now()}.${Math.random()}@bookmyclass.app`,
      role: Role.CLIENT,
      activationStatus: input.verified ? UserActivationStatus.ACTIVE : UserActivationStatus.PENDING,
      emailVerified: input.verified ? new Date() : null,
      isActive: input.verified,
      isInactive: !input.verified,
    },
  });
}

async function seedAdmin() {
  return prisma.user.create({
    data: {
      name: "Admin",
      email: `coupon.admin.${Date.now()}.${Math.random()}@bookmyclass.app`,
      role: Role.ADMIN,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: new Date(),
      isActive: true,
    },
    select: { id: true },
  });
}

async function seedCheckoutReadyCatalog(input?: {
  priceType?: PriceType;
  stripePriceId?: string | null;
  productType?: ProductType;
  unitAmountMinor?: number;
}) {
  const product = await prisma.product.create({
    data: {
      name: "Slice B Product",
      slug: `slice-b-product-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productType: input?.productType ?? ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `slice-b-price-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      stripePriceId:
        input?.stripePriceId === undefined ? `price_slice_b_${Date.now()}` : input?.stripePriceId,
      stripeSyncStatus:
        input?.stripePriceId === null ? StripeSyncStatus.PENDING : StripeSyncStatus.SYNCED,
      name: "Slice B Price",
      priceType: input?.priceType ?? PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input?.unitAmountMinor ?? 2500,
      billingInterval: input?.priceType === PriceType.RECURRING ? BillingInterval.MONTH : null,
      billingIntervalCount: input?.priceType === PriceType.RECURRING ? 1 : null,
      isActive: true,
      isArchived: false,
    },
  });

  return { product, price };
}

async function seedActiveLoyaltyProgramForProduct(productId: string) {
  const program = await prisma.loyaltyProgram.create({
    data: {
      currencyCode: "EUR",
      isActive: true,
      earningPoints: 1,
      earningAmountMinor: 100,
      pointsExpireAfterDays: 180,
      expirationReminderDays: 30,
      maxManualGrantPoints: 5_000,
    },
    select: { id: true },
  });

  await prisma.loyaltyEligibleProduct.create({
    data: {
      programId: program.id,
      productId,
      isActive: true,
    },
  });
}

async function seedCoupon(input?: {
  code?: string;
  discountType?: CouponDiscountType;
  discountPercentBps?: number | null;
  discountAmountMinor?: number | null;
  currencyCode?: string | null;
  status?: CouponStatus;
  startsAt?: Date | null;
  expiresAt?: Date;
  minOrderAmountMinor?: number | null;
  maxTotalRedemptions?: number | null;
  maxRedemptionsPerClient?: number | null;
  eligibleProductId?: string | null;
  eligiblePriceId?: string | null;
}) {
  const admin = await seedAdmin();
  return prisma.coupon.create({
    data: {
      code: input?.code ?? `SAVE${Math.floor(Math.random() * 900 + 100)}`,
      name: "Test coupon",
      status: input?.status ?? CouponStatus.ACTIVE,
      discountType: input?.discountType ?? CouponDiscountType.PERCENTAGE,
      discountPercentBps:
        input?.discountType === CouponDiscountType.FIXED_AMOUNT
          ? null
          : (input?.discountPercentBps ?? 2000),
      discountAmountMinor:
        input?.discountType === CouponDiscountType.FIXED_AMOUNT
          ? (input?.discountAmountMinor ?? 1000)
          : null,
      currencyCode:
        input?.discountType === CouponDiscountType.FIXED_AMOUNT
          ? (input?.currencyCode ?? "EUR")
          : null,
      startsAt: input?.startsAt ?? new Date(Date.now() - 60_000),
      expiresAt: input?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      minOrderAmountMinor: input?.minOrderAmountMinor ?? null,
      maxTotalRedemptions: input?.maxTotalRedemptions ?? null,
      maxRedemptionsPerClient: input?.maxRedemptionsPerClient ?? null,
      createdById: admin.id,
      eligibilities:
        input?.eligibleProductId || input?.eligiblePriceId
          ? {
              create: {
                productId: input?.eligibleProductId ?? null,
                priceId: input?.eligiblePriceId ?? null,
              },
            }
          : undefined,
    },
  });
}

async function createBookingOriginCheckoutFixture(input: {
  clientId: string;
  paymentSelection: BookingPaymentSelection;
  unitAmountMinor?: number;
}) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const category = await createClassCategory(prisma, {
    name: "Zero Pay Category",
    slug: `zero-pay-category-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Zero Pay Flow",
    slug: `zero-pay-flow-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Zero Pay Teacher",
      email: `teacher.zero-pay.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Zero Pay Template",
      slug: `zero-pay-template-${unique}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Zero Pay Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: "SCHEDULED",
      isPublished: true,
    },
  });

  const productType =
    input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
      ? ProductType.CLASS_PACK
      : ProductType.DROP_IN_CLASS;
  const product = await prisma.product.create({
    data: {
      name: productType === ProductType.CLASS_PACK ? "Zero Pay Class Pack" : "Zero Pay Drop-In",
      slug: `zero-pay-product-${unique}`,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `zero-pay-price-${unique}`,
      stripePriceId: `price_zero_pay_${unique}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "Zero Pay Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.unitAmountMinor ?? 2500,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType:
        input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
          ? EntitlementType.CREDIT_PACK
          : EntitlementType.SINGLE_USE,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? 10 : 1,
      isActive: true,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: input.clientId,
      status: BookingStatus.PENDING,
      paymentSelection: input.paymentSelection,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Zero Pay Client",
      customerEmail: "zero-pay@example.test",
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  return { booking, product, price, serviceSlug: classType.slug };
}

describe("POST /api/cart/checkout", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_cart_checkout_123",
      url: "https://checkout.stripe.com/pay/cs_test_cart_checkout_123",
    });
    vi.mocked(auth).mockResolvedValue(null);  }, 60000);

  it("rejects cross-origin", async () => {
    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174100",
        body: { lines: [], clientCartVersion: "v1" },
        headers: {
          origin: "https://evil.example",
          referer: "https://evil.example/cart",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("rejects missing idempotency key", async () => {
    const response = await cartCheckoutRoute(
      createRequest({
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("deterministically replays unauthenticated failure", async () => {
    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174101",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const firstBody = await first.json();
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174101",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(firstBody.code).toBe("AUTH_REQUIRED");
    expect(firstBody.idempotency).toMatchObject({
      key: "cartchk_123e4567-e89b-12d3-a456-426614174101",
      replayed: false,
    });
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("returns IDEMPOTENCY_CONFLICT for unauthenticated requests using same key with different payload", async () => {
    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174201",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174201",
        body: {
          lines: [{ productId: "prod_other", priceId: "price_other", quantity: 1 }],
          clientCartVersion: "v2",
        },
      }),
    );

    expect(first.status).toBe(401);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deterministically replays unverified failure", async () => {
    const client = await seedClient({ verified: false });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174102",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174102",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(403);
    expect(second.status).toBe(403);
    expect(secondBody.code).toBe("EMAIL_VERIFICATION_REQUIRED");
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("returns IDEMPOTENCY_CONFLICT for unverified requests using same key with different payload", async () => {
    const client = await seedClient({ verified: false });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174202",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174202",
        body: {
          lines: [{ productId: "prod_other", priceId: "price_other", quantity: 1 }],
          clientCartVersion: "v2",
        },
      }),
    );

    expect(first.status).toBe(403);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deterministically replays invalid payload failure", async () => {
    const client = await seedClient({ verified: true });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174103",
        body: { lines: [{ productId: "", priceId: "", quantity: 0 }], clientCartVersion: "" },
      }),
    );
    const firstBody = await first.json();
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174103",
        body: { lines: [{ productId: "", priceId: "", quantity: 0 }], clientCartVersion: "" },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(firstBody.code).toBe("INVALID_REQUEST");
    expect(firstBody.message).toBe("Invalid checkout payload.");
    expect(firstBody.idempotency).toMatchObject({
      key: "cartchk_123e4567-e89b-12d3-a456-426614174103",
      state: "SUCCEEDED",
      replayed: false,
    });
    expect(secondBody.code).toBe(firstBody.code);
    expect(secondBody.message).toBe(firstBody.message);
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("returns IDEMPOTENCY_CONFLICT for invalid JSON with same key and different payload", async () => {
    const client = await seedClient({ verified: true });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRawRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174204",
        rawBody: "{\"lines\":[",
      }),
    );

    const second = await cartCheckoutRoute(
      createRawRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174204",
        rawBody: "{\"lines\":}",
      }),
    );

    expect(first.status).toBe(400);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("deterministically replays invalid JSON with same key and same payload", async () => {
    const client = await seedClient({ verified: true });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRawRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174205",
        rawBody: "{\"lines\":[",
      }),
    );
    const firstBody = await first.json();

    const second = await cartCheckoutRoute(
      createRawRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174205",
        rawBody: "{\"lines\":[",
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(400);
    expect(second.status).toBe(400);
    expect(firstBody.code).toBe("INVALID_REQUEST");
    expect(firstBody.message).toBe("Invalid JSON payload.");
    expect(secondBody.code).toBe(firstBody.code);
    expect(secondBody.message).toBe(firstBody.message);
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("returns IDEMPOTENCY_CONFLICT for schema-invalid payloads with same key and different payload", async () => {
    const client = await seedClient({ verified: true });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174206",
        body: { lines: [{ productId: "", priceId: "", quantity: 0 }], clientCartVersion: "" },
      }),
    );
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174206",
        body: { lines: [{ productId: "x", priceId: "", quantity: 0 }], clientCartVersion: "" },
      }),
    );

    expect(first.status).toBe(400);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("maps empty cart to CART_VALIDATION_FAILED and replays deterministically", async () => {
    const client = await seedClient({ verified: true });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174104",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const firstBody = await first.json();
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174104",
        body: { lines: [], clientCartVersion: "v1" },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(422);
    expect(firstBody.code).toBe("CART_VALIDATION_FAILED");
    expect(second.status).toBe(422);
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("rejects cart checkout when DB stripePriceId is missing", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ stripePriceId: null });

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174250",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "CART_VALIDATION_FAILED" });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("maps mixed composition to CART_COMPOSITION_NOT_ALLOWED and replays deterministically", async () => {
    const client = await seedClient({ verified: true });
    const recurring = await seedCheckoutReadyCatalog({ priceType: PriceType.RECURRING });
    const oneTime = await seedCheckoutReadyCatalog({ priceType: PriceType.ONE_TIME });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174105",
        body: {
          lines: [
            { productId: recurring.product.id, priceId: recurring.price.id, quantity: 1 },
            { productId: oneTime.product.id, priceId: oneTime.price.id, quantity: 1 },
          ],
          clientCartVersion: "v1",
        },
      }),
    );
    const firstBody = await first.json();
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174105",
        body: {
          lines: [
            { productId: recurring.product.id, priceId: recurring.price.id, quantity: 1 },
            { productId: oneTime.product.id, priceId: oneTime.price.id, quantity: 1 },
          ],
          clientCartVersion: "v1",
        },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(409);
    expect(firstBody.code).toBe("CART_COMPOSITION_NOT_ALLOWED");
    expect(second.status).toBe(409);
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("allows high-value gift-card checkout through route", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 5_000_000,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174251",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 2 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
  });

  it("rejects merchandise quantity cap through route before checkout session creation", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 1_500,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174253",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 11 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "CART_VALIDATION_FAILED" });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
    await expect(prisma.order.count({ where: { clientId: client.id } })).resolves.toBe(0);
  });

  it("builds store Stripe line items from inline price_data even when stored Stripe price ID is stale", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      stripePriceId: "price_E2eMerchYogaMat",
      unitAmountMinor: 4500,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174254",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);

    const stripeArgs = createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0] as
      | { params?: Record<string, unknown> }
      | undefined;
    const lineItems = stripeArgs?.params?.line_items as Array<Record<string, unknown>> | undefined;
    const firstLine = lineItems?.[0];

    expect(firstLine?.price).toBeUndefined();
    expect(firstLine?.quantity).toBe(1);
    expect(firstLine?.price_data).toMatchObject({
      currency: "eur",
      unit_amount: 4500,
      product_data: {
        name: product.name,
      },
    });
  });

  it("returns IDEMPOTENCY_IN_PROGRESS for existing in-flight record", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const validation = await validateCart({ lines, clientId: client.id });
    expect(validation.ok).toBe(true);

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: "cartchk_123e4567-e89b-12d3-a456-426614174106",
        cartHash: validation.ok ? validation.cartHash : computeHash(lines),
        state: "IN_PROGRESS",
      },
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174106",
        body: { lines, clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_IN_PROGRESS" });
  });

  it("recovers stale IN_PROGRESS and proceeds with checkout", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const key = "cartchk_123e4567-e89b-12d3-a456-426614174113";
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const stale = new Date(Date.now() - 60_000);
    const record = await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: key,
        cartHash: computeHash(lines),
        state: "IN_PROGRESS",
      },
      select: { id: true },
    });

    await prisma.$executeRaw`
      UPDATE "CartCheckoutIdempotency"
      SET "updatedAt" = ${stale}
      WHERE id = ${record.id}
    `;

    const response = await cartCheckoutRoute(
      createRequest({
        key,
        body: { lines, clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("stripe_redirect");
    expect(body.status).toBe("CHECKOUT_SESSION_CREATED");
  });

  it("creates checkout session and persists order/payment", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174107",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      type: string;
      status: string;
      orderId: string;
      paymentId: string;
      checkoutSessionId: string;
      checkoutUrl: string;
      idempotency: { replayed: boolean; state: string };
    };

    expect(body.type).toBe("stripe_redirect");
    expect(body.status).toBe("CHECKOUT_SESSION_CREATED");
    expect(body.checkoutUrl).toContain("checkout.stripe.com");
    expect(body.idempotency.replayed).toBe(false);
    expect(body.idempotency.state).toBe("SUCCEEDED");

    const payment = await prisma.payment.findUnique({
      where: { id: body.paymentId },
      select: {
        status: true,
        provider: true,
        checkoutSource: true,
        stripeCheckoutSessionId: true,
      },
    });

    expect(payment).toMatchObject({
      status: PaymentStatus.PENDING,
      provider: PaymentProvider.STRIPE,
      checkoutSource: "CART_CHECKOUT_V1",
      stripeCheckoutSessionId: "cs_test_cart_checkout_123",
    });

    const stripeArgs = createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0] as
      | { params?: Record<string, unknown> }
      | undefined;
    expect(stripeArgs?.params?.mode).toBe("payment");
    const lineItems = stripeArgs?.params?.line_items as Array<{ price: string; quantity: number }> | undefined;
    expect(lineItems?.[0]?.price).toBe(price.stripePriceId);
    expect(lineItems?.[0]?.quantity).toBe(1);
    expect("subscription_data" in (stripeArgs?.params ?? {})).toBe(false);
    expect(stripeArgs?.params?.success_url).toBe(
      "http://localhost:3000/subscription/success?session_id={CHECKOUT_SESSION_ID}",
    );
    await expect(
      prisma.cartCheckoutIdempotency.findUniqueOrThrow({
        where: {
          userId_idempotencyKey: {
            userId: client.id,
            idempotencyKey: "cartchk_123e4567-e89b-12d3-a456-426614174107",
          },
        },
      }),
    ).resolves.toMatchObject({
      responseType: "STRIPE_REDIRECT",
      stripePaymentId: body.paymentId,
      checkoutSessionId: body.checkoutSessionId,
    });
  });

  it("replays the same successful response for same key + same cart", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174108",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    const firstBody = await first.json();

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174108",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({
      orderId: firstBody.orderId,
      paymentId: firstBody.paymentId,
      checkoutSessionId: firstBody.checkoutSessionId,
      checkoutUrl: firstBody.checkoutUrl,
      idempotency: {
        key: "cartchk_123e4567-e89b-12d3-a456-426614174108",
        replayed: true,
      },
    });
  });

  it("returns idempotency conflict for same key + different cart hash and replays deterministically", async () => {
    const client = await seedClient({ verified: true });
    const readyOne = await seedCheckoutReadyCatalog();
    const readyTwo = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174109",
        body: {
          lines: [{ productId: readyOne.product.id, priceId: readyOne.price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174109",
        body: {
          lines: [{ productId: readyTwo.product.id, priceId: readyTwo.price.id, quantity: 1 }],
          clientCartVersion: "v2",
        },
      }),
    );
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174109",
        body: {
          lines: [{ productId: readyTwo.product.id, priceId: readyTwo.price.id, quantity: 1 }],
          clientCartVersion: "v2",
        },
      }),
    );
    const secondBody = await second.json();

    expect(first.status).toBe(409);
    expect(second.status).toBe(409);
    expect(secondBody.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("resumes FAILED_AFTER_WRITE_PRE_STRIPE using same order/payment", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    getStripeServerEnvMock.mockImplementationOnce(() => {
      throw new Error("pre-stripe setup failure");
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174110",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(first.status).toBe(500);
    const createdPaymentsAfterFirstAttempt = await prisma.payment.findMany({
      where: { order: { clientId: client.id } },
      select: { id: true },
    });
    expect(createdPaymentsAfterFirstAttempt).toHaveLength(1);
    const firstPaymentId = createdPaymentsAfterFirstAttempt[0]?.id;

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174110",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.paymentId).toBeTruthy();
    if (firstPaymentId) {
      expect(secondBody.paymentId).toBe(firstPaymentId);
    }

    const orderCount = await prisma.order.count({ where: { clientId: client.id } });
    expect(orderCount).toBe(1);
  });

  it("escalates repeated FAILED_STRIPE_UNCERTAIN retries to deterministic terminal failure", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    createStripeCheckoutSessionWithIdempotencyMock
      .mockRejectedValueOnce(new Error("stripe network failure"))
      .mockRejectedValueOnce(new Error("stripe network failure"));

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174111",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(first.status).toBe(202);

    const firstArgs = createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0];

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174111",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(second.status).toBe(500);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      message: "Checkout could not be confirmed yet. Please retry shortly.",
      idempotency: {
        key: "cartchk_123e4567-e89b-12d3-a456-426614174111",
        state: "FAILED_STRIPE_UNCERTAIN",
        replayed: false,
      },
    });

    const secondArgs = createStripeCheckoutSessionWithIdempotencyMock.mock.calls[1]?.[0];
    expect(firstArgs.idempotencyKey).toBe(secondArgs.idempotencyKey);
    expect(firstArgs.params).toEqual(secondArgs.params);

    const third = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174111",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(third.status).toBe(500);
    await expect(third.json()).resolves.toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      idempotency: {
        key: "cartchk_123e4567-e89b-12d3-a456-426614174111",
        replayed: true,
      },
    });
  });

  it("persists deterministic replay state when uncertain escalation happens from stale path", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const key = "cartchk_123e4567-e89b-12d3-a456-426614174114";

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    createStripeCheckoutSessionWithIdempotencyMock
      .mockRejectedValueOnce(new Error("stripe network failure"))
      .mockRejectedValueOnce(new Error("stripe network failure"));

    const first = await cartCheckoutRoute(
      createRequest({
        key,
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(first.status).toBe(202);

    const idempotency = await prisma.cartCheckoutIdempotency.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: client.id,
          idempotencyKey: key,
        },
      },
      select: { id: true },
    });

    await prisma.$executeRaw`
      UPDATE "CartCheckoutIdempotency"
      SET "updatedAt" = ${new Date(Date.now() - 60_000)}
      WHERE id = ${idempotency.id}
    `;

    const second = await cartCheckoutRoute(
      createRequest({
        key,
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(second.status).toBe(500);
    const secondBody = await second.json();
    expect(secondBody).toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      idempotency: {
        key,
        state: "FAILED_STRIPE_UNCERTAIN",
        replayed: false,
      },
    });
    const persisted = await prisma.cartCheckoutIdempotency.findUniqueOrThrow({
      where: {
        userId_idempotencyKey: {
          userId: client.id,
          idempotencyKey: key,
        },
      },
      select: {
        state: true,
        responseStatus: true,
        responseCode: true,
      },
    });
    expect(persisted.state).toBe("SUCCEEDED");
    expect(persisted.responseStatus).toBe(500);
    expect(persisted.responseCode).toBe("CHECKOUT_CREATE_FAILED");

    const third = await cartCheckoutRoute(
      createRequest({
        key,
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );
    expect(third.status).toBe(500);
    const thirdBody = await third.json();
    expect(thirdBody).toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      message: "Checkout could not be confirmed yet. Please retry shortly.",
      idempotency: {
        key,
        replayed: true,
      },
    });
  });

  it("classifies deterministic Stripe invalid request errors as immediate terminal failure", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const key = "cartchk_123e4567-e89b-12d3-a456-426614174115";

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const stripeError = Object.assign(
      new Error("You passed an empty string for 'subscription_data'."),
      {
        name: "StripeInvalidRequestError",
        type: "StripeInvalidRequestError",
        code: "parameter_invalid_empty",
        param: "subscription_data",
        statusCode: 400,
      },
    );

    createStripeCheckoutSessionWithIdempotencyMock.mockRejectedValueOnce(stripeError);

    const response = await cartCheckoutRoute(
      createRequest({
        key,
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      idempotency: {
        key,
        state: "FAILED_AFTER_WRITE_PRE_STRIPE",
        replayed: false,
      },
    });
  });

  it("handles concurrent same-key checkout safely", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    createStripeCheckoutSessionWithIdempotencyMock.mockImplementationOnce(async () => {
      await gate;
      return {
        id: "cs_test_cart_checkout_123",
        url: "https://checkout.stripe.com/pay/cs_test_cart_checkout_123",
      };
    });

    const req1 = createRequest({
      key: "cartchk_123e4567-e89b-12d3-a456-426614174112",
      body: {
        lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
        clientCartVersion: "v1",
      },
    });
    const req2 = createRequest({
      key: "cartchk_123e4567-e89b-12d3-a456-426614174112",
      body: {
        lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
        clientCartVersion: "v1",
      },
    });

    const p1 = cartCheckoutRoute(req1);
    const p2 = cartCheckoutRoute(req2);

    await Promise.resolve();
    if (release) {
      release();
    }

    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 202]);
  });

  it("handles concurrent retries from FAILED_BEFORE_WRITE without duplicate order/payment writes", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const key = "cartchk_123e4567-e89b-12d3-a456-426614174203";
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: key,
        cartHash: computeHash(lines),
        state: "FAILED_BEFORE_WRITE",
      },
    });

    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    createStripeCheckoutSessionWithIdempotencyMock.mockImplementationOnce(async () => {
      await gate;
      return {
        id: "cs_test_cart_checkout_123",
        url: "https://checkout.stripe.com/pay/cs_test_cart_checkout_123",
      };
    });

    const requestBody = { lines, clientCartVersion: "v1" };
    const p1 = cartCheckoutRoute(createRequest({ key, body: requestBody }));
    const p2 = cartCheckoutRoute(createRequest({ key, body: requestBody }));

    await Promise.resolve();
    if (release) {
      release();
    }

    const [r1, r2] = await Promise.all([p1, p2]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toSatisfy((value: number[]) =>
      JSON.stringify(value) === JSON.stringify([200, 200]) ||
      JSON.stringify(value) === JSON.stringify([200, 202]),
    );

    const orders = await prisma.order.findMany({
      where: { clientId: client.id },
      select: { id: true },
    });
    const payments = await prisma.payment.findMany({
      where: { order: { clientId: client.id } },
      select: { id: true },
    });

    expect(orders).toHaveLength(1);
    expect(payments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Slice 4 — Cart Contract / Rate Limits
// ---------------------------------------------------------------------------

describe("POST /api/cart/checkout — Slice 4 idempotency edge cases (formerly flag tests)", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_slice4_123",
      url: "https://checkout.stripe.com/pay/cs_test_slice4_123",
    });
    vi.mocked(auth).mockResolvedValue(null);  }, 60000);

  it("gift-card checkout proceeds without feature flags (store always on)", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00001-0000-0000-0000-000000000001",
        body: { lines: [{ productId: product.id, priceId: price.id, quantity: 1 }], clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
  });

  it("merchandise checkout proceeds without feature flags (store always on)", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.MERCHANDISE });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00002-0000-0000-0000-000000000002",
        body: { lines: [{ productId: product.id, priceId: price.id, quantity: 1 }], clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
  });

  it("rejects enabled wallet redemption when available balance is insufficient", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00011-0000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2500,
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("rejects wallet redemption for recurring-only carts", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      priceType: PriceType.RECURRING,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00008-0000-0000-0000-000000000008",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2500,
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "WALLET_REDEMPTION_REQUIRES_ONE_TIME_CART",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("wallet redemption eligible for one-time plan cart (CLASS_PACK) — proceeds past eligibility check", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      priceType: PriceType.ONE_TIME,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00008-0000-0000-0000-100000000008",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2500,
        },
      }),
    );

    // No wallet exists → balance error, not eligibility error.
    // This confirms the server no longer blocks wallet on ONE_TIME plan products.
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("rejects loyalty credit for recurring carts before any reservation path", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      priceType: PriceType.RECURRING,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00011-0000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          loyaltyCreditAmountMinor: 1200,
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "LOYALTY_CREDIT_REQUIRES_ONE_TIME_CART",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("rejects one-time loyalty credit requests while checkout redemption remains deferred", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.CLASS_PACK });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00012-0000-0000-0000-000000000012",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          loyaltyCreditAmountMinor: 1200,
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "LOYALTY_CREDIT_NOT_ACTIVE",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("rejects walletAmountMinor above the route max", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4a00009-0000-0000-0000-000000000009",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 50001,
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("service guard deterministically rejects walletAmountMinor above max", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const key = "cartchk_f4a00010-0000-0000-0000-000000000010";

    const first = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      walletAmountMinor: 50001,
    });
    const second = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      walletAmountMinor: 50001,
    });

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(first.body.code).toBe("WALLET_REDEMPTION_EXCEEDS_MAX");
    expect(second.body.idempotency).toMatchObject({ replayed: true });
  });

  it("service guard deterministically rejects loyalty credit above max", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.CLASS_PACK });
    const key = "cartchk_f4a00013-0000-0000-0000-000000000013";

    const first = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      loyaltyCreditAmountMinor: 50001,
    });
    const second = await startCartCheckout({
      userId: client.id,
      idempotencyKey: key,
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      loyaltyCreditAmountMinor: 50001,
    });

    expect(first.status).toBe(422);
    expect(second.status).toBe(422);
    expect(first.body.code).toBe("LOYALTY_CREDIT_AMOUNT_EXCEEDS_MAX");
    expect(second.body.idempotency).toMatchObject({ replayed: true });
  });

  it("validation error replays deterministically for same key+cart", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // No wallet seeded → GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE (idempotency record written)
    const reqOpts = {
      key: "cartchk_f4a00007-0000-0000-0000-000000000007",
      body: {
        lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
        clientCartVersion: "v1",
        walletAmountMinor: 2500,
      },
    };

    const first = await cartCheckoutRoute(createRequest(reqOpts));
    const second = await cartCheckoutRoute(createRequest(reqOpts));

    expect(first.status).toBe(second.status);
    const secondBody = await second.json();
    expect(secondBody.idempotency.replayed).toBe(true);
  });
});

describe("POST /api/cart/checkout — Slice 4 idempotency with wallet fields", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_slice4_wallet_123",
      url: "https://checkout.stripe.com/pay/cs_test_slice4_wallet_123",
    });
    vi.mocked(auth).mockResolvedValue(null);  }, 60000);

  it("same key + different walletAmountMinor returns IDEMPOTENCY_CONFLICT", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const key = "cartchk_f4b00001-0000-0000-0000-000000000001";

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // First request: no wallet seeded → validation error, but idempotency record is created
    await cartCheckoutRoute(
      createRequest({
        key,
        body: { lines, clientCartVersion: "v1", walletAmountMinor: 5000 },
      }),
    );

    // Second request: same key but different wallet amount
    const second = await cartCheckoutRoute(
      createRequest({
        key,
        body: { lines, clientCartVersion: "v1", walletAmountMinor: 10000 },
      }),
    );

    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("same key + same walletAmountMinor replays correctly", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const key = "cartchk_f4b00002-0000-0000-0000-000000000002";

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const body = { lines, clientCartVersion: "v1", walletAmountMinor: 5000 };

    const first = await cartCheckoutRoute(createRequest({ key, body }));
    const second = await cartCheckoutRoute(createRequest({ key, body }));

    // Both return same status, second is a replay
    expect(first.status).toBe(second.status);
    const secondBody = await second.json();
    expect(secondBody.idempotency.replayed).toBe(true);
  });

  it("idempotency replay returns type:completed response when seeded with COMPLETED response type", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const key = "cartchk_f4b00003-0000-0000-0000-000000000003";
    const cartHash = computeHash(lines);

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const completedBody = {
      type: "completed",
      orderId: "test-order-id-s4b",
      paymentMethod: "GIFT_CARD",
      redirectUrl: "http://localhost:3000/store/success?orderId=test-order-id-s4b",
      idempotency: { key, state: "SUCCEEDED", replayed: false },
    };

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: key,
        cartHash,
        state: "SUCCEEDED",
        responseStatus: 200,
        responseCode: "COMPLETED",
        responseBody: completedBody as Prisma.InputJsonValue,
        responseType: "COMPLETED",
        redemptionId: "redemption-test-id",
        giftCardPaymentId: "gc-payment-test-id",
      },
    });

    const response = await cartCheckoutRoute(
      createRequest({ key, body: { lines, clientCartVersion: "v1" } }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("completed");
    expect(body.orderId).toBe("test-order-id-s4b");
    expect(body.paymentMethod).toBe("GIFT_CARD");
    expect(body.idempotency.replayed).toBe(true);
  });

  it("idempotency replay returns type:stripe_redirect response when seeded with STRIPE_REDIRECT response type", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const key = "cartchk_f4b00004-0000-0000-0000-000000000004";
    const cartHash = computeHash(lines);

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const redirectBody = {
      type: "stripe_redirect",
      orderId: "test-order-id-s4b-stripe",
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_slice4_partial_123",
      idempotency: { key, state: "SUCCEEDED", replayed: false },
    };

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: key,
        cartHash,
        state: "SUCCEEDED",
        responseStatus: 200,
        responseCode: "STRIPE_REDIRECT",
        responseBody: redirectBody as Prisma.InputJsonValue,
        responseType: "STRIPE_REDIRECT",
        stripePaymentId: "stripe-payment-test-id",
        checkoutSessionId: "cs_test_slice4_partial_123",
      },
    });

    const response = await cartCheckoutRoute(
      createRequest({ key, body: { lines, clientCartVersion: "v1" } }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("stripe_redirect");
    expect(body.orderId).toBe("test-order-id-s4b-stripe");
    expect(body.checkoutUrl).toBe("https://checkout.stripe.com/pay/cs_test_slice4_partial_123");
    expect(body.idempotency.replayed).toBe(true);
  });

  it("idempotency replay with wallet redemption fields (redemptionId, giftCardPaymentId) returns same result", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const walletAmount = 2500;
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];
    const key = "cartchk_f4b00005-0000-0000-0000-000000000005";
    const baseHash = computeHash(lines);
    const walletAugmentedHash = `${baseHash}|walletAmountMinor=${walletAmount}`;

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const completedBody = {
      type: "completed",
      orderId: "wallet-order-id",
      paymentMethod: "GIFT_CARD",
      redirectUrl: "http://localhost:3000/store/success?orderId=wallet-order-id",
      idempotency: { key, state: "SUCCEEDED", replayed: false },
    };

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: key,
        cartHash: walletAugmentedHash,
        state: "SUCCEEDED",
        responseStatus: 200,
        responseCode: "COMPLETED",
        responseBody: completedBody as Prisma.InputJsonValue,
        responseType: "COMPLETED",
        redemptionId: "redemption-wallet-id",
        giftCardPaymentId: "gc-payment-wallet-id",
      },
    });

    // Replay with same wallet amount → same hash → replay
    const response = await cartCheckoutRoute(
      createRequest({
        key,
        body: { lines, clientCartVersion: "v1", walletAmountMinor: walletAmount },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.type).toBe("completed");
    expect(body.orderId).toBe("wallet-order-id");
    expect(body.idempotency.replayed).toBe(true);
  });
});

describe("POST /api/cart/checkout — Slice 4 gift-card rate limits", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_slice4_rate_123",
      url: "https://checkout.stripe.com/pay/cs_test_slice4_rate_123",
    });
    vi.mocked(auth).mockResolvedValue(null);  }, 60000);

  it("gift-card checkout rate limit: 11th attempt within window returns 429", async () => {
    const client = await seedClient({ verified: true });
    const { product } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // Seed rate limit counter at the max (10 attempts)
    const keyHash = hashRateLimitKey("gift_card_checkout", client.id);
    await prisma.rateLimitCounter.create({
      data: {
        keyHash,
        windowStartedAt: new Date(),
        requestCount: 10,
      },
    });

    // Seed a valid price (counter already at max for gift_card_checkout)
    const price = await prisma.price.findFirst({
      where: { productId: product.id },
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4c00001-0000-0000-0000-000000000001",
        body: {
          lines: [{ productId: product.id, priceId: price!.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
  });

  it("stored validation error replays even when checkout rate limit is exhausted", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });
    const key = "cartchk_f4c00004-0000-0000-0000-000000000004";

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // No wallet seeded → GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE; idempotency record is written
    const request = {
      key,
      body: {
        lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
        clientCartVersion: "v1",
        walletAmountMinor: 2500,
      },
    };

    const first = await cartCheckoutRoute(createRequest(request));
    expect(first.status).toBe(422);
    await expect(first.json()).resolves.toMatchObject({
      code: "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE",
      idempotency: { replayed: false },
    });

    await prisma.rateLimitCounter.upsert({
      where: { keyHash: hashRateLimitKey("gift_card_checkout", client.id) },
      create: {
        keyHash: hashRateLimitKey("gift_card_checkout", client.id),
        windowStartedAt: new Date(),
        requestCount: 10,
      },
      update: { requestCount: 10 },
    });

    const second = await cartCheckoutRoute(createRequest(request));

    expect(second.status).toBe(422);
    await expect(second.json()).resolves.toMatchObject({
      code: "GIFT_CARD_INSUFFICIENT_AVAILABLE_BALANCE",
      idempotency: { replayed: true },
    });
  });

  it("gift-card redemption rate limit: 6th attempt within window returns 429", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.GIFT_CARD });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // Seed redemption counter at the max (5 attempts)
    const keyHash = hashRateLimitKey("gift_card_redemption", client.id);
    await prisma.rateLimitCounter.create({
      data: {
        keyHash,
        windowStartedAt: new Date(),
        requestCount: 5,
      },
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4c00002-0000-0000-0000-000000000002",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2500,
        },
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "RATE_LIMIT_EXCEEDED" });
  });

  it("gift-card rate limit does not block non-store (CLASS_PACK) checkout", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.CLASS_PACK });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    // Seed gift_card_checkout counter at max — should have no effect for CLASS_PACK
    const keyHash = hashRateLimitKey("gift_card_checkout", client.id);
    await prisma.rateLimitCounter.create({
      data: {
        keyHash,
        windowStartedAt: new Date(),
        requestCount: 10,
      },
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f4c00003-0000-0000-0000-000000000003",
        body: { lines: [{ productId: product.id, priceId: price.id, quantity: 1 }], clientCartVersion: "v1" },
      }),
    );

    expect(response.status).toBe(200);
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/cart/checkout — Slice 1D coupon checkout", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_coupon_checkout_123",
      url: "https://checkout.stripe.com/pay/cs_test_coupon_checkout_123",
    });
    vi.mocked(auth).mockResolvedValue(null);
  }, 60000);

  it("applies a percentage coupon and charges Stripe only for the discounted remainder", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "SAVE20",
      discountType: CouponDiscountType.PERCENTAGE,
      discountPercentBps: 2000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000001-0000-0000-0000-000000000001",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: " save20 ",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: "stripe_redirect",
      checkoutSessionId: "cs_test_coupon_checkout_123",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
    expect(createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0]).toMatchObject({
      params: {
        line_items: [
          {
            price_data: expect.objectContaining({
              unit_amount: 2000,
            }),
            quantity: 1,
          },
        ],
        metadata: expect.objectContaining({
          couponId: coupon.id,
          couponCode: coupon.code,
        }),
      },
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { items: true, payments: true },
    });
    expect(order).toMatchObject({
      couponId: coupon.id,
      couponCodeSnapshot: "SAVE20",
      discountAmountMinor: 500,
      totalAmountMinor: 2000,
      status: OrderStatus.PLACED,
    });
    expect(order.items[0]).toMatchObject({
      lineDiscountAmountMinor: 500,
      lineTotalAmountMinor: 2000,
    });
    expect(order.payments).toEqual([
      expect.objectContaining({
        provider: PaymentProvider.STRIPE,
        amountMinor: 2000,
        status: PaymentStatus.PENDING,
      }),
    ]);
  });

  it("rejects coupons for recurring memberships", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      priceType: PriceType.RECURRING,
      unitAmountMinor: 4900,
    });
    await seedCoupon({
      code: "MEMBER20",
      discountType: CouponDiscountType.PERCENTAGE,
      discountPercentBps: 2000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000002-0000-0000-0000-000000000002",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "MEMBER20",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COUPON_RECURRING_NOT_SUPPORTED",
      message:
        "Coupons are not available for recurring memberships yet. Remove the coupon or choose a one-time product.",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("rejects coupons for gift-card purchases", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 2500,
    });
    await seedCoupon({
      code: "GIFTSAVE",
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountAmountMinor: 1000,
      currencyCode: "EUR",
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000003-0000-0000-0000-000000000003",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "GIFTSAVE",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "COUPON_GIFT_CARD_NOT_SUPPORTED",
      message: "Coupons cannot be used for gift-card purchases.",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
  });

  it("applies coupon before wallet and charges Stripe only for the final remainder", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    await seedCoupon({
      code: "SAVE10FIX",
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountAmountMinor: 1000,
      currencyCode: "EUR",
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000004-0000-0000-0000-000000000004",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "SAVE10FIX",
          walletAmountMinor: 2000,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: "stripe_redirect",
      checkoutSessionId: "cs_test_coupon_checkout_123",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0]).toMatchObject({
      params: {
        line_items: [
          {
            price_data: expect.objectContaining({
              unit_amount: 2000,
            }),
            quantity: 1,
          },
        ],
      },
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    expect(order).toMatchObject({
      discountAmountMinor: 1000,
      totalAmountMinor: 4000,
      status: OrderStatus.PLACED,
    });
    expect(order.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: PaymentProvider.INTERNAL,
          method: PaymentMethod.GIFT_CARD,
          amountMinor: 2000,
        }),
        expect.objectContaining({
          provider: PaymentProvider.STRIPE,
          amountMinor: 2000,
        }),
      ]),
    );
  });

  it("coupon-only zero-payable checkout completes locally with a zero-value manual payment", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2500,
    });
    await seedActiveLoyaltyProgramForProduct(product.id);
    const coupon = await seedCoupon({
      code: "FREE2500",
      discountType: CouponDiscountType.FIXED_AMOUNT,
      discountAmountMinor: 2500,
      currencyCode: "EUR",
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000005-0000-0000-0000-000000000005",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "FREE2500",
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: "completed",
      paymentMethod: PaymentMethod.MANUAL,
      redirectUrl: expect.stringContaining("/store/success?orderId="),
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    expect(order).toMatchObject({
      status: OrderStatus.PAID,
      couponId: coupon.id,
      couponCodeSnapshot: coupon.code,
      discountAmountMinor: 2500,
      totalAmountMinor: 0,
    });
    expect(order.payments).toEqual([
      expect.objectContaining({
        method: PaymentMethod.MANUAL,
        provider: PaymentProvider.INTERNAL,
        status: PaymentStatus.SUCCEEDED,
        amountMinor: 0,
      }),
    ]);
    expect(order.couponRedemptions).toEqual([
      expect.objectContaining({
        status: "APPLIED",
        discountAmountMinor: 2500,
        totalAfterMinor: 0,
      }),
    ]);
    await expect(prisma.loyaltyPointsLedgerEntry.count({
      where: { orderId: order.id },
    })).resolves.toBe(0);
  });

  it("ignores expired reserved coupon rows when enforcing usage limits", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "LIMIT1",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
      maxTotalRedemptions: 1,
    });

    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId: client.id,
        status: CouponRedemptionStatus.RESERVED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 2500,
        discountAmountMinor: 250,
        totalAfterMinor: 2250,
        currencyCode: "EUR",
        idempotencyKey: `expired-reservation-${Date.now()}`,
        payloadHash: `expired-payload-${Date.now()}`,
        reservedAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000008-0000-0000-0000-000000000008",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: coupon.code,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(
      prisma.couponRedemption.findMany({
        where: { couponId: coupon.id },
        orderBy: { createdAt: "asc" },
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: CouponRedemptionStatus.RESERVED,
          expiresAt: expect.any(Date),
        }),
      ]),
    );
  });

  it("Stripe completion moves coupon redemption from RESERVED to APPLIED", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "SAVE10",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000009-0000-0000-0000-000000000009",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: coupon.code,
        },
      }),
    );

    expect(response.status).toBe(200);
    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;
    expect(order.couponRedemptions).toEqual([
      expect.objectContaining({
        status: CouponRedemptionStatus.RESERVED,
        stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
      }),
    ]);

    await processStripeWebhookEvent({
      id: `evt_coupon_success_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_coupon_success",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment.id,
            userId: client.id,
          },
        },
      },
    } as never);

    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: order.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.APPLIED,
      paymentId: stripePayment.id,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
      appliedAt: expect.any(Date),
    });
  });

  it("replayed Stripe completion does not double-apply coupon redemption", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: `REPLAYOK${Date.now()}`,
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000009-1000-0000-0000-000000000009",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: coupon.code,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;
    const redemption = order.couponRedemptions[0]!;

    const buildCompletedEvent = (eventId: string) =>
      ({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_coupon_checkout_123",
            mode: "payment",
            payment_status: "paid",
            payment_intent: "pi_coupon_success_replay",
            metadata: {
              source: "CART_CHECKOUT_V1",
              orderId: order.id,
              paymentId: stripePayment.id,
              userId: client.id,
            },
          },
        },
      }) as never;

    await processStripeWebhookEvent(buildCompletedEvent(`evt_coupon_success_replay_a_${Date.now()}`));
    await processStripeWebhookEvent(buildCompletedEvent(`evt_coupon_success_replay_b_${Date.now()}`));

    expect(
      await prisma.couponRedemption.count({
        where: { orderId: order.id },
      }),
    ).toBe(1);
    await expect(
      prisma.couponRedemption.findUniqueOrThrow({
        where: { id: redemption.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.APPLIED,
      paymentId: stripePayment.id,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
    });
    expect(
      await prisma.auditLog.count({
        where: {
          actionType: "coupon.reconciliation_required",
          entityType: "CouponRedemption",
          entityId: redemption.id,
        },
      }),
    ).toBe(0);
  });

  it("Stripe checkout expiration moves coupon redemption from RESERVED to EXPIRED", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "SAVE10",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000010-0000-0000-0000-000000000010",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: coupon.code,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
    });

    await processStripeWebhookEvent({
      id: `evt_coupon_expired_${Date.now()}`,
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
        },
      },
    } as never);

    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: order.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.EXPIRED,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
      failureReason: "Checkout session expired.",
    });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });
  });

  it("async Stripe payment failure moves coupon redemption from RESERVED to REVERSED", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "SAVE10",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000011-0000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: coupon.code,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
    });

    await processStripeWebhookEvent({
      id: `evt_coupon_async_failed_${Date.now()}`,
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
        },
      },
    } as never);

    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: order.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.REVERSED,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
      failureReason: "Async payment failed.",
      reversedAt: expect.any(Date),
    });
  });

  it("writes a reconciliation audit signal when coupon settlement fails after Stripe payment success", async () => {
    const client = await seedClient({ verified: true });
    const couponCode = `AUDIT${Date.now()}`;
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: couponCode,
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000011-1000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;
    const redemption = order.couponRedemptions[0]!;

    const settleSpy = vi
      .spyOn(couponValidationService, "settleCouponRedemptionForCartCheckout")
      .mockImplementationOnce(async (input) => {
        if (input.nextStatus === CouponRedemptionStatus.APPLIED) {
          throw new Error("coupon apply failed after Stripe success");
        }

        return 0;
      });

    await expect(
      processStripeWebhookEvent({
        id: `evt_coupon_apply_failure_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_coupon_checkout_123",
            mode: "payment",
            payment_status: "paid",
            payment_intent: "pi_coupon_apply_failure",
            metadata: {
              source: "CART_CHECKOUT_V1",
              orderId: order.id,
              paymentId: stripePayment.id,
              userId: client.id,
            },
          },
        },
      } as never),
    ).rejects.toThrow("Coupon settlement failed after payment success.");

    settleSpy.mockRestore();

    await expect(prisma.payment.findUniqueOrThrow({ where: { id: stripePayment.id } })).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
    });
    await expect(prisma.order.findUniqueOrThrow({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PLACED,
    });
    await expect(prisma.couponRedemption.findUniqueOrThrow({ where: { id: redemption.id } })).resolves.toMatchObject({
      status: CouponRedemptionStatus.RESERVED,
    });
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          actionType: "coupon.reconciliation_required",
          entityType: "CouponRedemption",
          entityId: redemption.id,
        },
      }),
    ).resolves.toMatchObject({
      metadata: expect.objectContaining({
        couponId: coupon.id,
        clientId: client.id,
        orderId: order.id,
        paymentId: stripePayment.id,
        stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
        redemptionStatus: CouponRedemptionStatus.RESERVED,
        stage: "stripe_checkout_success_coupon_settlement",
        source: "stripe-webhook",
        error: expect.objectContaining({
          message: "coupon apply failed after Stripe success",
        }),
      }),
    });
  });

  it("replayed coupon settlement failures record only one reconciliation alert", async () => {
    const client = await seedClient({ verified: true });
    const couponCode = `REPLAY${Date.now()}`;
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    await seedCoupon({
      code: couponCode,
      discountPercentBps: 1000,
      eligibleProductId: product.id,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000011-2000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;
    const redemption = order.couponRedemptions[0]!;

    const settleSpy = vi
      .spyOn(couponValidationService, "settleCouponRedemptionForCartCheckout")
      .mockRejectedValue(new Error("coupon apply failed after Stripe success"));

    const buildCompletedEvent = (eventId: string) =>
      ({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_coupon_checkout_123",
            mode: "payment",
            payment_status: "paid",
            payment_intent: "pi_coupon_apply_failure_replay",
            metadata: {
              source: "CART_CHECKOUT_V1",
              orderId: order.id,
              paymentId: stripePayment.id,
              userId: client.id,
            },
          },
        },
      }) as never;

    await expect(
      processStripeWebhookEvent(buildCompletedEvent(`evt_coupon_apply_failure_replay_a_${Date.now()}`)),
    ).rejects.toThrow("Coupon settlement failed after payment success.");
    await expect(
      processStripeWebhookEvent(buildCompletedEvent(`evt_coupon_apply_failure_replay_b_${Date.now()}`)),
    ).rejects.toThrow("Coupon settlement failed after payment success.");

    settleSpy.mockRestore();

    expect(
      await prisma.auditLog.count({
        where: {
          actionType: "coupon.reconciliation_required",
          entityType: "CouponRedemption",
          entityId: redemption.id,
        },
      }),
    ).toBe(1);
  });

  it("does not write a coupon reconciliation alert for non-coupon settlement failures", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000011-3000-0000-0000-000000000011",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;

    const settleOrderSpy = vi
      .spyOn(checkoutFinalizationService, "settleSuccessfulCheckoutOrder")
      .mockRejectedValueOnce(new Error("non-coupon settlement failed after Stripe success"));

    await expect(
      processStripeWebhookEvent({
        id: `evt_non_coupon_failure_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_coupon_checkout_123",
            mode: "payment",
            payment_status: "paid",
            payment_intent: "pi_non_coupon_failure",
            metadata: {
              source: "CART_CHECKOUT_V1",
              orderId: order.id,
              paymentId: stripePayment.id,
              userId: client.id,
            },
          },
        },
      } as never),
    ).rejects.toThrow("non-coupon settlement failed after Stripe success");

    settleOrderSpy.mockRestore();

    expect(
      await prisma.auditLog.count({
        where: {
          actionType: "coupon.reconciliation_required",
        },
      }),
    ).toBe(0);
  });

  it("same-key retry after deterministic pre-Stripe failure re-reserves and later applies the coupon", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    await seedCoupon({
      code: "SAVE10",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
      maxTotalRedemptions: 1,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    getStripeServerEnvMock.mockImplementationOnce(() => {
      throw new Error("pre-stripe setup failure");
    });

    const requestBody = {
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      couponCode: "SAVE10",
    };

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000012-0000-0000-0000-000000000012",
        body: requestBody,
      }),
    );

    expect(first.status).toBe(500);
    await expect(first.json()).resolves.toMatchObject({
      code: "CHECKOUT_CREATE_FAILED",
      idempotency: {
        state: "FAILED_AFTER_WRITE_PRE_STRIPE",
      },
    });

    const orderAfterFirstAttempt = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
    });
    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: orderAfterFirstAttempt.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.REVERSED,
      failureReason: "pre-stripe setup failure",
      reversedAt: expect.any(Date),
    });

    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000012-0000-0000-0000-000000000012",
        body: requestBody,
      }),
    );

    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      type: "stripe_redirect",
      checkoutSessionId: "cs_test_coupon_checkout_123",
    });

    const orderAfterRetry = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, couponRedemptions: true },
    });
    const stripePayment = orderAfterRetry.payments.find(
      (payment) => payment.provider === PaymentProvider.STRIPE,
    )!;
    expect(orderAfterRetry.id).toBe(orderAfterFirstAttempt.id);
    expect(orderAfterRetry.couponRedemptions).toEqual([
      expect.objectContaining({
        status: CouponRedemptionStatus.RESERVED,
        paymentId: stripePayment.id,
        stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
        reversedAt: null,
        failureReason: null,
      }),
    ]);

    await processStripeWebhookEvent({
      id: `evt_coupon_retry_success_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_coupon_retry_success",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: orderAfterRetry.id,
            paymentId: stripePayment.id,
            userId: client.id,
          },
        },
      },
    } as never);

    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: orderAfterRetry.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.APPLIED,
      paymentId: stripePayment.id,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
      appliedAt: expect.any(Date),
    });
  });

  it("expired coupon retry is revalidated before reservation revival", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const coupon = await seedCoupon({
      code: "FLASH10",
      discountPercentBps: 1000,
      eligibleProductId: product.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 2500,
        discountAmountMinor: 250,
        totalAmountMinor: 2250,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
      },
      select: { id: true },
    });

    await prisma.couponRedemption.create({
      data: {
        couponId: coupon.id,
        clientId: client.id,
        orderId: order.id,
        status: CouponRedemptionStatus.EXPIRED,
        couponCodeSnapshot: coupon.code,
        subtotalBeforeMinor: 2500,
        discountAmountMinor: 250,
        totalAfterMinor: 2250,
        currencyCode: "EUR",
        idempotencyKey: `coupon:${coupon.id}:client:${client.id}:order:${order.id}:attempt:expired-retry`,
        payloadHash: `expired-retry-${Date.now()}`,
        reservedAt: new Date(Date.now() - 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 30 * 60 * 1000),
        failureReason: "Checkout session expired.",
      },
    });

    await prisma.coupon.update({
      where: { id: coupon.id },
      data: {
        expiresAt: new Date(Date.now() - 1_000),
      },
    });

    const result = await prisma.$transaction((tx) =>
      reserveCouponRedemptionForCartCheckout({
        tx,
        coupon: {
          couponId: coupon.id,
          couponCode: coupon.code,
          discountType: CouponDiscountType.PERCENTAGE,
        },
        clientId: client.id,
        orderId: order.id,
        paymentId: null,
        pricing: {
          subtotalAmountMinor: 2500,
          discountAmountMinor: 250,
          totalAmountMinor: 2250,
          currencyCode: "EUR",
          coupon: {
            couponId: coupon.id,
            couponCode: coupon.code,
            discountType: CouponDiscountType.PERCENTAGE,
          },
          pricedLines: [
            {
              productId: product.id,
              priceId: price.id,
              productName: product.name,
              priceName: price.name,
              productDescription: null,
              quantity: 1,
              unitAmountMinor: 2500,
              lineSubtotalAmountMinor: 2500,
              billingInterval: null,
              billingIntervalCount: null,
              lineTotalAmountMinor: 2250,
              lineDiscountAmountMinor: 250,
              currencyCode: "EUR",
              priceType: PriceType.ONE_TIME,
              productType: ProductType.CLASS_PACK,
              couponEligible: true,
            },
          ],
        },
        idempotencyKey: "expired-retry",
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "COUPON_NOT_ACTIVE",
    });
    await expect(
      prisma.couponRedemption.findFirstOrThrow({
        where: { orderId: order.id },
      }),
    ).resolves.toMatchObject({
      status: CouponRedemptionStatus.EXPIRED,
      failureReason: "Checkout session expired.",
    });
  });

  it("same key with different coupon codes returns IDEMPOTENCY_CONFLICT", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    await seedCoupon({ code: "SAVE10", discountPercentBps: 1000, eligibleProductId: product.id });
    await seedCoupon({ code: "SAVE20", discountPercentBps: 2000, eligibleProductId: product.id });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000006-0000-0000-0000-000000000006",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "SAVE10",
        },
      }),
    );
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000006-0000-0000-0000-000000000006",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          couponCode: "SAVE20",
        },
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("same key with the same coupon code replays the completed checkout response", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    await seedCoupon({ code: "SAVE10", discountPercentBps: 1000, eligibleProductId: product.id });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const body = {
      lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
      clientCartVersion: "v1",
      couponCode: "SAVE10",
    };

    const first = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000007-0000-0000-0000-000000000007",
        body,
      }),
    );
    const second = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_d1000007-0000-0000-0000-000000000007",
        body,
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      idempotency: {
        replayed: true,
      },
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
  });

  it("booking-origin zero-payable checkout confirms booking and does not duplicate ownership on replay", async () => {
    const client = await seedClient({ verified: true });
    const fixture = await createBookingOriginCheckoutFixture({
      clientId: client.id,
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      unitAmountMinor: 2500,
    });
    await seedCoupon({
      code: "FREEBOOK",
      discountPercentBps: 10_000,
      eligiblePriceId: fixture.price.id,
    });

    const checkoutInput = {
      userId: client.id,
      idempotencyKey: `bookcart_${fixture.booking.id}`,
      lines: [{ productId: fixture.product.id, priceId: fixture.price.id, quantity: 1 }],
      clientCartVersion: `booking:${fixture.booking.id}`,
      couponCode: "FREEBOOK",
      redirectUrls: {
        successUrl: `http://localhost:3000/book-a-class/${fixture.serviceSlug}/payment/success?bookingId=${fixture.booking.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `http://localhost:3000/book-a-class/${fixture.serviceSlug}/payment/cancel?bookingId=${fixture.booking.id}`,
      },
      metadataOverrides: {
        bookingId: fixture.booking.id,
        serviceSlug: fixture.serviceSlug,
        paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
        selectedPriceId: fixture.price.id,
        productId: fixture.product.id,
      },
    } as const;

    const first = await startCartCheckout(checkoutInput);
    const second = await startCartCheckout(checkoutInput);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      type: "completed",
      paymentMethod: PaymentMethod.MANUAL,
      redirectUrl: expect.stringContaining(`/book-a-class/${fixture.serviceSlug}/payment/success?bookingId=${fixture.booking.id}`),
    });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      idempotency: {
        replayed: true,
      },
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: {
        status: true,
        selectedEntitlementId: true,
        orderId: true,
      },
    });
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.selectedEntitlementId).toBeTruthy();
    expect(booking.orderId).toBeTruthy();

    await expect(
      prisma.payment.findFirst({
        where: {
          orderId: booking.orderId!,
          provider: PaymentProvider.INTERNAL,
          method: PaymentMethod.MANUAL,
          amountMinor: 0,
        },
      }),
    ).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
      checkoutSource: "CART_CHECKOUT_V1",
    });

    const [entitlementCount, grantCount, consumeCount, bookingEmailCount] = await Promise.all([
      prisma.clientEntitlement.count({
        where: {
          clientId: client.id,
          orderId: booking.orderId!,
        },
      }),
      prisma.creditLedgerEntry.count({
        where: {
          clientId: client.id,
          orderId: booking.orderId!,
          entryType: CreditLedgerEntryType.GRANT,
        },
      }),
      prisma.creditLedgerEntry.count({
        where: {
          clientId: client.id,
          bookingId: fixture.booking.id,
          entryType: CreditLedgerEntryType.CONSUME,
        },
      }),
      prisma.emailAutomationEvent.count({
        where: {
          payloadJson: {
            path: ["bookingId"],
            equals: fixture.booking.id,
          },
        },
      }),
    ]);

    expect(entitlementCount).toBe(1);
    expect(grantCount).toBe(1);
    expect(consumeCount).toBe(1);
    expect(bookingEmailCount).toBe(1);
  });

  it("booking-origin paid Stripe checkout confirms booking and does not duplicate ownership on webhook replay", async () => {
    const client = await seedClient({ verified: true });
    const fixture = await createBookingOriginCheckoutFixture({
      clientId: client.id,
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      unitAmountMinor: 2500,
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const checkoutInput = {
      userId: client.id,
      idempotencyKey: `bookcart_paid_${fixture.booking.id}`,
      lines: [{ productId: fixture.product.id, priceId: fixture.price.id, quantity: 1 }],
      clientCartVersion: `booking-paid:${fixture.booking.id}`,
      redirectUrls: {
        successUrl: `http://localhost:3000/book-a-class/${fixture.serviceSlug}/payment/success?bookingId=${fixture.booking.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `http://localhost:3000/book-a-class/${fixture.serviceSlug}/payment/cancel?bookingId=${fixture.booking.id}`,
      },
      metadataOverrides: {
        bookingId: fixture.booking.id,
        serviceSlug: fixture.serviceSlug,
        paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
        selectedPriceId: fixture.price.id,
        productId: fixture.product.id,
      },
    } as const;

    const checkout = await startCartCheckout(checkoutInput);

    expect(checkout.status).toBe(200);
    expect(checkout.body).toMatchObject({
      type: "stripe_redirect",
      checkoutSessionId: "cs_test_coupon_checkout_123",
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_coupon_checkout_123",
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    const stripePayment = order.payments.find(
      (payment) => payment.provider === PaymentProvider.STRIPE,
    );
    expect(stripePayment).toMatchObject({
      status: PaymentStatus.PENDING,
      amountMinor: 2500,
      checkoutSource: "CART_CHECKOUT_V1",
    });

    await processStripeWebhookEvent({
      id: `evt_booking_paid_success_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_booking_paid_success",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment!.id,
            userId: client.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            productId: fixture.product.id,
          },
        },
      },
    } as never);

    await processStripeWebhookEvent({
      id: `evt_booking_paid_replay_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_coupon_checkout_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_booking_paid_replay",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment!.id,
            userId: client.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            productId: fixture.product.id,
          },
        },
      },
    } as never);

    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: fixture.booking.id },
      select: {
        status: true,
        selectedEntitlementId: true,
        orderId: true,
      },
    });
    expect(booking.status).toBe(BookingStatus.CONFIRMED);
    expect(booking.selectedEntitlementId).toBeTruthy();
    expect(booking.orderId).toBe(order.id);

    await expect(
      prisma.payment.findUnique({
        where: { id: stripePayment!.id },
      }),
    ).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
      stripeCheckoutSessionId: "cs_test_coupon_checkout_123",
    });

    const [entitlementCount, grantCount, consumeCount, bookingEmailCount] = await Promise.all([
      prisma.clientEntitlement.count({
        where: {
          clientId: client.id,
          orderId: order.id,
        },
      }),
      prisma.creditLedgerEntry.count({
        where: {
          clientId: client.id,
          orderId: order.id,
          entryType: CreditLedgerEntryType.GRANT,
        },
      }),
      prisma.creditLedgerEntry.count({
        where: {
          clientId: client.id,
          bookingId: fixture.booking.id,
          entryType: CreditLedgerEntryType.CONSUME,
        },
      }),
      prisma.emailAutomationEvent.count({
        where: {
          payloadJson: {
            path: ["bookingId"],
            equals: fixture.booking.id,
          },
        },
      }),
    ]);

    expect(entitlementCount).toBe(1);
    expect(grantCount).toBe(1);
    expect(consumeCount).toBe(1);
    expect(bookingEmailCount).toBe(1);
  });
});

describe("POST /api/cart/checkout — Slice 5 wallet checkout", () => {
  beforeEach(async () => {
    await resetDb();
    createStripeCheckoutSessionWithIdempotencyMock.mockReset();
    getStripeServerEnvMock.mockReset();
    getStripeServerEnvMock.mockReturnValue({
      appUrl: "http://localhost:3000",
      secretKey: "sk_test_123",
      webhookSecret: "whsec_123",
    });
    createStripeCheckoutSessionWithIdempotencyMock.mockResolvedValue({
      id: "cs_test_slice5_partial_123",
      url: "https://checkout.stripe.com/pay/cs_test_slice5_partial_123",
    });  }, 60000);

  it("full wallet checkout creates order and GIFT_CARD payment without Stripe", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2500,
    });
    await seedActiveLoyaltyProgramForProduct(product.id);
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 2500 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000001-0000-0000-0000-000000000001",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2500,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: "completed",
      paymentMethod: "GIFT_CARD",
      redirectUrl: expect.stringContaining("/store/success?orderId="),
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, giftCardRedemptions: true },
    });
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.payments).toEqual([
      expect.objectContaining({
        method: PaymentMethod.GIFT_CARD,
        provider: PaymentProvider.INTERNAL,
        status: PaymentStatus.SUCCEEDED,
      }),
    ]);
    expect(order.giftCardRedemptions[0]).toMatchObject({
      status: "CAPTURED",
      reservedAmountMinor: 2500,
      capturedAmountMinor: 2500,
    });
    await expect(prisma.loyaltyPointsLedgerEntry.count({
      where: { orderId: order.id },
    })).resolves.toBe(0);
  });

  it("partial wallet plus Stripe creates reservation, GIFT_CARD payment, and Stripe payment", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000002-0000-0000-0000-000000000002",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2000,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: "stripe_redirect",
      checkoutUrl: "https://checkout.stripe.com/pay/cs_test_slice5_partial_123",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).toHaveBeenCalledTimes(1);
    expect(createStripeCheckoutSessionWithIdempotencyMock.mock.calls[0]?.[0]).toMatchObject({
      params: {
        line_items: [
          {
            price_data: expect.objectContaining({
              unit_amount: 3000,
            }),
            quantity: 1,
          },
        ],
        success_url: "http://localhost:3000/store/success?session_id={CHECKOUT_SESSION_ID}",
      },
    });

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, giftCardRedemptions: true },
    });
    expect(order.status).toBe(OrderStatus.PLACED);
    expect(order.payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: PaymentMethod.GIFT_CARD,
          provider: PaymentProvider.INTERNAL,
          status: PaymentStatus.PENDING,
          amountMinor: 2000,
        }),
        expect.objectContaining({
          method: PaymentMethod.CARD,
          provider: PaymentProvider.STRIPE,
          status: PaymentStatus.PENDING,
          amountMinor: 3000,
        }),
      ]),
    );
    expect(order.giftCardRedemptions[0]).toMatchObject({
      status: "RESERVED",
      reservedAmountMinor: 2000,
    });
  });

  it("Stripe success captures wallet before marking internal GIFT_CARD payment succeeded", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000003-0000-0000-0000-000000000003",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2000,
        },
      }),
    );
    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;

    await processStripeWebhookEvent({
      id: `evt_slice5_success_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_slice5_partial_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_slice5_success",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment.id,
            userId: client.id,
          },
        },
      },
    } as never);

    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: PaymentProvider.STRIPE, status: PaymentStatus.SUCCEEDED }),
        expect.objectContaining({ provider: PaymentProvider.INTERNAL, status: PaymentStatus.SUCCEEDED }),
      ]),
    );
    await expect(prisma.giftCardWallet.findFirst({ where: { clientId: client.id } })).resolves.toMatchObject({
      balanceMinor: 3000,
    });
    await expect(prisma.giftCardRedemption.findFirst({ where: { orderId: order.id } })).resolves.toMatchObject({
      status: "CAPTURED",
      capturedAmountMinor: 2000,
    });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PAID,
    });
  });

  it("Stripe success marks internal payment succeeded when redemption was already captured", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000006-0000-0000-0000-000000000006",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2000,
        },
      }),
    );

    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true, giftCardRedemptions: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;
    const giftCardPayment = order.payments.find((payment) => payment.provider === PaymentProvider.INTERNAL)!;
    const redemption = order.giftCardRedemptions[0]!;

    await captureGiftCardRedemption({
      actor: { type: "SYSTEM", label: "slice5-test-pre-captured" },
      redemptionId: redemption.id,
      paymentId: giftCardPayment.id,
      idempotencyKey: `gift-card:capture:redemption:${redemption.id}`,
    });

    await processStripeWebhookEvent({
      id: `evt_slice5_precaptured_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_slice5_partial_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_slice5_precaptured",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment.id,
            userId: client.id,
          },
        },
      },
    } as never);

    await expect(prisma.payment.findUnique({ where: { id: giftCardPayment.id } })).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
    await expect(prisma.giftCardRedemption.findUnique({ where: { id: redemption.id } })).resolves.toMatchObject({
      status: GiftCardRedemptionStatus.CAPTURED,
    });
    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.PAID,
    });
  });

  it("Stripe failure releases wallet reservation and marks gift-card payment failed", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000004-0000-0000-0000-000000000004",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2000,
        },
      }),
    );
    const order = await prisma.order.findFirstOrThrow({ where: { clientId: client.id } });

    await processStripeWebhookEvent({
      id: `evt_slice5_expired_${Date.now()}`,
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_slice5_partial_123" } },
    } as never);

    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });
    await expect(prisma.giftCardRedemption.findFirst({ where: { orderId: order.id } })).resolves.toMatchObject({
      status: "RELEASED",
      releasedAmountMinor: 2000,
    });
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: PaymentProvider.STRIPE, status: PaymentStatus.FAILED }),
        expect.objectContaining({ provider: PaymentProvider.INTERNAL, status: PaymentStatus.FAILED }),
      ]),
    );
  });

  it("late Stripe success after released wallet does not mark the order paid", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 5000,
    });
    await prisma.giftCardWallet.create({
      data: { clientId: client.id, currencyCode: "EUR", balanceMinor: 5000 },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await cartCheckoutRoute(
      createRequest({
        key: "cartchk_f5000007-0000-0000-0000-000000000007",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
          walletAmountMinor: 2000,
        },
      }),
    );
    const order = await prisma.order.findFirstOrThrow({
      where: { clientId: client.id },
      include: { payments: true },
    });
    const stripePayment = order.payments.find((payment) => payment.provider === PaymentProvider.STRIPE)!;

    await processStripeWebhookEvent({
      id: `evt_slice5_expired_before_late_success_${Date.now()}`,
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_slice5_partial_123" } },
    } as never);

    await processStripeWebhookEvent({
      id: `evt_slice5_late_success_after_release_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_slice5_partial_123",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_slice5_late_success",
          metadata: {
            source: "CART_CHECKOUT_V1",
            orderId: order.id,
            paymentId: stripePayment.id,
            userId: client.id,
          },
        },
      },
    } as never);

    await expect(prisma.order.findUnique({ where: { id: order.id } })).resolves.toMatchObject({
      status: OrderStatus.CANCELLED,
    });
    await expect(prisma.giftCardRedemption.findFirst({ where: { orderId: order.id } })).resolves.toMatchObject({
      status: GiftCardRedemptionStatus.RELEASED,
    });
    const payments = await prisma.payment.findMany({ where: { orderId: order.id } });
    expect(payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: PaymentProvider.STRIPE, status: PaymentStatus.FAILED }),
        expect.objectContaining({ provider: PaymentProvider.INTERNAL, status: PaymentStatus.FAILED }),
      ]),
    );
    await expect(prisma.giftCardReconciliationCase.findFirst({ where: { orderId: order.id } })).resolves.toMatchObject({
      status: GiftCardReconciliationStatus.MANUAL_REVIEW,
      reason: "STRIPE_PAID_AFTER_GIFT_CARD_RELEASE",
      redemptionId: expect.any(String),
      paymentId: stripePayment.id,
    });
  });

  it("success validation rejects wrong user, mismatched session, and wrong order id", async () => {
    const client = await seedClient({ verified: true });
    const otherClient = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.CLASS_PACK,
      unitAmountMinor: 2500,
    });
    const order = await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 2500,
        totalAmountMinor: 2500,
        currencyCode: "EUR",
        status: OrderStatus.PAID,
        items: {
          create: {
            productId: product.id,
            priceId: price.id,
            quantity: 1,
            productNameSnapshot: product.name,
            priceNameSnapshot: price.name,
            unitAmountMinor: 2500,
            lineSubtotalAmountMinor: 2500,
            lineTotalAmountMinor: 2500,
            currencyCode: "EUR",
          },
        },
        payments: {
          create: {
            status: PaymentStatus.SUCCEEDED,
            method: PaymentMethod.CARD,
            provider: PaymentProvider.STRIPE,
            amountMinor: 2500,
            currencyCode: "EUR",
            stripeCheckoutSessionId: "cs_success_owner",
          },
        },
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: otherClient.id, name: otherClient.name, email: otherClient.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const wrongUser = await cartSuccessValidateRoute(
      new Request(`http://localhost/api/cart/success/validate?orderId=${order.id}`),
    );
    expect(wrongUser.status).toBe(404);

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const wrongSession = await cartSuccessValidateRoute(
      new Request(`http://localhost/api/cart/success/validate?orderId=${order.id}&session_id=cs_wrong`),
    );
    expect(wrongSession.status).toBe(404);

    const wrongOrder = await cartSuccessValidateRoute(
      new Request("http://localhost/api/cart/success/validate?orderId=missing-order&session_id=cs_success_owner"),
    );
    expect(wrongOrder.status).toBe(404);
  });
});



