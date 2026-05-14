import "./helpers/setup-env";

import {
  GiftCardCodeStatus,
  OrderStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  UserActivationStatus,
} from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth", () => ({
  auth: vi.fn(async () => null),
}));

import { auth } from "../../src/auth";
import { POST as redeemGiftCardRoute } from "../../src/app/api/gift-cards/redeem/route";
import { issueGiftCardCode, redeemGiftCardCode } from "../../src/lib/gift-cards/gift-card-code-service";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/dashboard/wallet",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

function createRedeemRequest(input: {
  body: object;
  headers?: Record<string, string>;
}) {
  return new NextRequest("http://localhost/api/gift-cards/redeem", {
    method: "POST",
    headers: {
      ...sameOriginHeaders,
      ...(input.headers ?? {}),
    },
    body: JSON.stringify(input.body),
  });
}

async function seedUser(input?: {
  role?: Role;
  activationStatus?: UserActivationStatus;
  emailVerified?: Date | null;
  isActive?: boolean;
}) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.user.create({
    data: {
      name: "Gift Card Redeem API User",
      email: `gift-card-redeem-api-${ts}@example.test`,
      role: input?.role ?? Role.CLIENT,
      activationStatus: input?.activationStatus ?? UserActivationStatus.ACTIVE,
      emailVerified: input?.emailVerified === undefined ? new Date() : input.emailVerified,
      isActive: input?.isActive ?? true,
      isInactive: !(input?.isActive ?? true),
    },
    select: { id: true, email: true, name: true },
  });
}

async function seedGiftCardCode(input: { purchaserId: string; amountMinor?: number }) {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const amountMinor = input.amountMinor ?? 2_500;

  const product = await prisma.product.create({
    data: {
      name: `Redeem API Gift Card ${ts}`,
      slug: `redeem-api-gift-card-${ts}`,
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
    select: { id: true },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `redeem-api-gift-card-${ts}`,
      stripePriceId: `price_redeem_api_${ts}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: "Redeem API Gift Card",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: amountMinor,
      isActive: true,
      isArchived: false,
    },
    select: { id: true },
  });

  const order = await prisma.order.create({
    data: {
      clientId: input.purchaserId,
      subtotalAmountMinor: amountMinor,
      totalAmountMinor: amountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
      items: {
        create: {
          productId: product.id,
          priceId: price.id,
          productNameSnapshot: "Redeem API Gift Card",
          priceNameSnapshot: "Redeem API Gift Card",
          quantity: 1,
          unitAmountMinor: amountMinor,
          lineSubtotalAmountMinor: amountMinor,
          lineTotalAmountMinor: amountMinor,
          currencyCode: "EUR",
        },
      },
    },
    include: { items: true },
  });

  const issued = await issueGiftCardCode({
    orderId: order.id,
    orderItemId: order.items[0]!.id,
    purchasedById: input.purchaserId,
    amountMinor,
  });
  if (issued.alreadyIssued) {
    throw new Error("Expected fresh gift-card code.");
  }

  return { order, plaintextCode: issued.plaintextCode };
}

describe("POST /api/gift-cards/redeem", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockResolvedValue(null);
  });

  it("rejects cross-origin redemption attempts", async () => {
    const response = await redeemGiftCardRoute(
      createRedeemRequest({
        body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" },
        headers: {
          origin: "https://evil.example",
          referer: "https://evil.example/dashboard/wallet",
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("requires an authenticated session", async () => {
    const response = await redeemGiftCardRoute(
      createRedeemRequest({ body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" } }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized." });
  });

  it("requires an active verified client", async () => {
    const unverified = await seedUser({ emailVerified: null });
    vi.mocked(auth).mockResolvedValue({
      user: { id: unverified.id, name: unverified.name, email: unverified.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await redeemGiftCardRoute(
      createRedeemRequest({ body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" } }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });

  it("rejects non-client roles", async () => {
    const admin = await seedUser({ role: Role.ADMIN });
    vi.mocked(auth).mockResolvedValue({
      user: { id: admin.id, name: admin.name, email: admin.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await redeemGiftCardRoute(
      createRedeemRequest({ body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" } }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "EMAIL_VERIFICATION_REQUIRED" });
  });

  it("redeems a valid code without exposing purchaser, order, or codeHash data", async () => {
    const purchaser = await seedUser();
    const redeemer = await seedUser();
    const { plaintextCode } = await seedGiftCardCode({ purchaserId: purchaser.id, amountMinor: 3_000 });
    vi.mocked(auth).mockResolvedValue({
      user: { id: redeemer.id, name: redeemer.name, email: redeemer.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await redeemGiftCardRoute(createRedeemRequest({ body: { code: plaintextCode } }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      amountRedeemedMinor: 3_000,
      currencyCode: "EUR",
      newBalanceMinor: 3_000,
    });
    expect(JSON.stringify(body)).not.toContain("codeHash");
    expect(JSON.stringify(body)).not.toContain(purchaser.id);
    expect(JSON.stringify(body)).not.toContain("order");
  });

  it("returns the same generic response for malformed, unknown, and already-redeemed codes", async () => {
    const client = await seedUser();
    const { plaintextCode } = await seedGiftCardCode({ purchaserId: client.id });
    await redeemGiftCardCode({
      redeemerUserId: client.id,
      redeemerClientId: client.id,
      plaintextCode,
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const malformed = await redeemGiftCardRoute(createRedeemRequest({ body: { code: "not-a-code" } }));
    const malformedBody = await malformed.json();
    const unknown = await redeemGiftCardRoute(
      createRedeemRequest({ body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" } }),
    );
    const unknownBody = await unknown.json();
    const alreadyRedeemed = await redeemGiftCardRoute(createRedeemRequest({ body: { code: plaintextCode } }));
    const alreadyRedeemedBody = await alreadyRedeemed.json();

    expect(malformed.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(alreadyRedeemed.status).toBe(422);
    expect(malformedBody).toEqual({ error: "Invalid or already used gift card code.", code: "INVALID_OR_USED" });
    expect(unknownBody).toEqual(malformedBody);
    expect(alreadyRedeemedBody).toEqual(malformedBody);
  });

  it("does not include codeHash in generic failure responses", async () => {
    const client = await seedUser();
    const { order } = await seedGiftCardCode({ purchaserId: client.id });
    await prisma.giftCardCode.update({
      where: { orderItemId: order.items[0]!.id },
      data: { status: GiftCardCodeStatus.VOIDED },
    });
    vi.mocked(auth).mockResolvedValue({
      user: { id: client.id, name: client.name, email: client.email },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const response = await redeemGiftCardRoute(
      createRedeemRequest({ body: { code: "AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD" } }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(JSON.stringify(body)).not.toContain("codeHash");
  });
});
