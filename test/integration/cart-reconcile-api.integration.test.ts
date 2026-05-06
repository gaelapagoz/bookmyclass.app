import "./helpers/setup-env";

import {
  PriceType,
  ProductType,
  StripeSyncStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { POST as cartReconcileRoute } from "../../src/app/api/cart/reconcile/route";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

const sameOriginHeaders = {
  "content-type": "application/json",
  origin: "http://localhost",
  referer: "http://localhost/cart",
  "x-forwarded-host": "localhost",
  "x-forwarded-proto": "http",
};

function createRequest(body: object, headers?: Record<string, string>) {
  return new Request("http://localhost/api/cart/reconcile", {
    method: "POST",
    headers: {
      ...sameOriginHeaders,
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

function createRawRequest(rawBody: string) {
  return new Request("http://localhost/api/cart/reconcile", {
    method: "POST",
    headers: sameOriginHeaders,
    body: rawBody,
  });
}

async function seedPrice(input: {
  name: string;
  active: boolean;
  endsAt?: Date | null;
}) {
  const product = await prisma.product.create({
    data: {
      name: input.name,
      slug: `${input.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      productType: ProductType.CLASS_PACK,
      isActive: input.active,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `${input.name.toLowerCase().replace(/\s+/g, "-")}-price-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      stripePriceId: `price_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
      name: `${input.name} Price`,
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2500,
      isActive: true,
      isArchived: false,
      endsAt: input.endsAt,
    },
  });

  return { product, price };
}

describe("POST /api/cart/reconcile", () => {
  beforeEach(async () => {
    await resetDb();
    vi.mocked(auth).mockResolvedValue({ user: { id: "client-1" } } as never);
  });

  it("rejects unauthenticated requests with 401", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await cartReconcileRoute(createRequest({ lines: [] }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("removes expired and deleted cart lines using server catalog truth", async () => {
    const active = await seedPrice({ name: "Active Pack", active: true });
    const expired = await seedPrice({
      name: "Expired Pack",
      active: true,
      endsAt: new Date(Date.now() - 60_000),
    });

    const response = await cartReconcileRoute(
      createRequest({
        lines: [
          { productId: active.product.id, priceId: active.price.id, quantity: 1 },
          { productId: expired.product.id, priceId: expired.price.id, quantity: 1 },
          { productId: "deleted_product", priceId: "deleted_price", quantity: 1 },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lines: [
        expect.objectContaining({
          productId: active.product.id,
          priceId: active.price.id,
          productName: "Active Pack",
        }),
      ],
      removedCount: 2,
      removedLines: expect.arrayContaining([
        expect.objectContaining({ productId: expired.product.id, priceId: expired.price.id, reason: "PRICE_NOT_ACTIVE" }),
        expect.objectContaining({ productId: "deleted_product", priceId: "deleted_price", reason: "PRICE_NOT_ACTIVE" }),
      ]),
    });
  });

  it("returns an empty response contract for an empty cart", async () => {
    const response = await cartReconcileRoute(createRequest({ lines: [] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lines: [],
      removedCount: 0,
      removedLines: [],
    });
  });

  it("rejects malformed JSON with INVALID_REQUEST", async () => {
    const response = await cartReconcileRoute(createRawRequest("{\"lines\":["));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_REQUEST",
      message: "Invalid JSON payload.",
    });
  });

  it("rejects schema-invalid and oversized cart reconciliation payloads", async () => {
    const invalidSchema = await cartReconcileRoute(
      createRequest({ lines: [{ productId: "", priceId: "price_1", quantity: 1 }] }),
    );
    expect(invalidSchema.status).toBe(400);
    await expect(invalidSchema.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });

    const oversizedIds = await cartReconcileRoute(
      createRequest({
        lines: [{ productId: "p".repeat(129), priceId: "price_1", quantity: 1 }],
      }),
    );
    expect(oversizedIds.status).toBe(400);
    await expect(oversizedIds.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });

    const oversizedLines = await cartReconcileRoute(
      createRequest({
        lines: Array.from({ length: 51 }, (_, index) => ({
          productId: `product_${index}`,
          priceId: `price_${index}`,
          quantity: 1,
        })),
      }),
    );
    expect(oversizedLines.status).toBe(400);
    await expect(oversizedLines.json()).resolves.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects cross-origin reconciliation requests", async () => {
    const response = await cartReconcileRoute(
      createRequest(
        { lines: [] },
        {
          origin: "https://evil.example",
          referer: "https://evil.example/cart",
        },
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("rejects requests with both Origin and Referer headers absent", async () => {
    const response = await cartReconcileRoute(
      new Request("http://localhost/api/cart/reconcile", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-host": "localhost",
          "x-forwarded-proto": "http",
        },
        body: JSON.stringify({ lines: [] }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("removes inactive product lines with PRODUCT_NOT_ACTIVE reason", async () => {
    const active = await seedPrice({ name: "Active Pack", active: true });
    const inactive = await seedPrice({ name: "Inactive Pack", active: false });

    const response = await cartReconcileRoute(
      createRequest({
        lines: [
          { productId: active.product.id, priceId: active.price.id, quantity: 1 },
          { productId: inactive.product.id, priceId: inactive.price.id, quantity: 1 },
        ],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      lines: [expect.objectContaining({ productId: active.product.id })],
      removedCount: 1,
      removedLines: expect.arrayContaining([
        expect.objectContaining({ productId: inactive.product.id, reason: "PRODUCT_NOT_ACTIVE" }),
      ]),
    });
  });
});
