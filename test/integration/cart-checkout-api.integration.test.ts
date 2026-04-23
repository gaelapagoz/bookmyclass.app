import "./helpers/setup-env";

import {
  BillingInterval,
  PaymentProvider,
  PaymentStatus,
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
import { computeCartHash as computeHash } from "../../src/lib/cart/cart-hash";
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

async function seedCheckoutReadyCatalog(input?: { priceType?: PriceType; stripePriceId?: string | null }) {
  const product = await prisma.product.create({
    data: {
      name: "Slice B Product",
      slug: `slice-b-product-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productType: ProductType.CLASS_PACK,
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
      unitAmountMinor: 2500,
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
      status: string;
      orderId: string;
      paymentId: string;
      checkoutSessionId: string;
      checkoutUrl: string;
      idempotency: { replayed: boolean; state: string };
    };

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
