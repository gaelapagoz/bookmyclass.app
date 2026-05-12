import "./helpers/setup-env";

import {
  BillingInterval,
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
import { computeCartHash as computeHash } from "../../src/lib/cart/cart-hash";
import { hashRateLimitKey } from "../../src/lib/security/db-rate-limit";
import { processStripeWebhookEvent } from "../../src/lib/public-booking/stripe-webhook-service";
import { captureGiftCardRedemption } from "../../src/lib/gift-cards/gift-card-wallet-service";
import { prisma } from "./helpers/db";
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
      email: `client.sliceb.${Date.now()}.${Math.random()}@example.test`,
      role: Role.CLIENT,
      activationStatus: input.verified ? UserActivationStatus.ACTIVE : UserActivationStatus.PENDING,
      emailVerified: input.verified ? new Date() : null,
      isActive: input.verified,
      isInactive: !input.verified,
    },
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
    vi.mocked(auth).mockResolvedValue(null);
  });

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

  it("rejects gift-card checkout through route when wallet cap would be exceeded", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 15_000,
    });
    await prisma.giftCardWallet.create({
      data: {
        clientId: client.id,
        currencyCode: "EUR",
        balanceMinor: 90_000,
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174251",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
          clientCartVersion: "v1",
        },
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "GIFT_CARD_WALLET_CAP_EXCEEDED",
    });
    expect(createStripeCheckoutSessionWithIdempotencyMock).not.toHaveBeenCalled();
    await expect(prisma.order.count({ where: { clientId: client.id } })).resolves.toBe(0);
  });

  it("counts only pending unpaid gift-card orders for route wallet cap checks", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.GIFT_CARD,
      unitAmountMinor: 15_000,
    });
    await prisma.giftCardWallet.create({
      data: {
        clientId: client.id,
        currencyCode: "EUR",
        balanceMinor: 60_000,
      },
    });
    await prisma.order.create({
      data: {
        clientId: client.id,
        subtotalAmountMinor: 30_000,
        totalAmountMinor: 30_000,
        currencyCode: "EUR",
        status: OrderStatus.PLACED,
        items: {
          create: {
            productId: product.id,
            priceId: price.id,
            quantity: 2,
            productNameSnapshot: product.name,
            priceNameSnapshot: price.name,
            unitAmountMinor: 15_000,
            lineSubtotalAmountMinor: 30_000,
            lineTotalAmountMinor: 30_000,
            currencyCode: "EUR",
          },
        },
        payments: {
          create: {
            status: PaymentStatus.FAILED,
            method: PaymentMethod.CARD,
            provider: PaymentProvider.STRIPE,
            amountMinor: 30_000,
            currencyCode: "EUR",
          },
        },
      },
    });

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await cartCheckoutRoute(
      createRequest({
        key: "cartchk_123e4567-e89b-12d3-a456-426614174252",
        body: {
          lines: [{ productId: product.id, priceId: price.id, quantity: 1 }],
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

  it("returns IDEMPOTENCY_IN_PROGRESS for existing in-flight record", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog();
    const lines = [{ productId: product.id, priceId: price.id, quantity: 1 }];

    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    await prisma.cartCheckoutIdempotency.create({
      data: {
        userId: client.id,
        idempotencyKey: "cartchk_123e4567-e89b-12d3-a456-426614174106",
        cartHash: computeHash(lines),
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
    vi.mocked(auth).mockResolvedValue(null);
  });

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

  it("rejects wallet redemption for non-store carts", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({ productType: ProductType.CLASS_PACK });

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
      code: "WALLET_REDEMPTION_REQUIRES_STORE_ITEMS",
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
    vi.mocked(auth).mockResolvedValue(null);
  });

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
    vi.mocked(auth).mockResolvedValue(null);
  });

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
    });
  });

  it("full wallet checkout creates order and GIFT_CARD payment without Stripe", async () => {
    const client = await seedClient({ verified: true });
    const { product, price } = await seedCheckoutReadyCatalog({
      productType: ProductType.MERCHANDISE,
      unitAmountMinor: 2500,
    });
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
