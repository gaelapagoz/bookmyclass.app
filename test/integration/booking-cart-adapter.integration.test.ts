import "./helpers/setup-env";

import {
  BookingPaymentSelection,
  BookingStatus,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  BookingCartAdapterError,
  buildCanonicalBookingCartAdapterInput,
} from "../../src/lib/public-booking/booking-cart-adapter";

async function createBookingFixture(input: {
  paymentSelection: BookingPaymentSelection;
  withOrder?: boolean;
}) {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const category = await createClassCategory(prisma, {
    name: "Yoga Collective",
    slug: `yoga-collective-${unique}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa Yoga",
    slug: `vinyasa-${unique}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Adapter",
      email: `teacher.adapter.${unique}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Vinyasa Template",
      slug: `vinyasa-template-${unique}`,
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
      title: "Vinyasa Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: "SCHEDULED",
      isPublished: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client Adapter",
      email: `client.adapter.${unique}@example.test`,
      role: Role.CLIENT,
    },
  });

  const productType =
    input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
      ? ProductType.CLASS_PACK
      : ProductType.DROP_IN_CLASS;
  const product = await prisma.product.create({
    data: {
      name: productType === ProductType.CLASS_PACK ? "10-Class Pack" : "Drop-In Class",
      slug: `${productType.toLowerCase()}-${unique}`,
      productType,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `adapter-price-${unique}`,
      name: "Standard Price",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? 15000 : 2200,
      stripePriceId: `price_adapter_${unique}`,
      stripeSyncStatus: StripeSyncStatus.SYNCED,
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

  const order = input.withOrder
    ? await prisma.order.create({
        data: {
          clientId: client.id,
          subtotalAmountMinor: price.unitAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: price.unitAmountMinor,
          currencyCode: "EUR",
          status: "PLACED",
          notes: "Adapter test order",
        },
      })
    : null;

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: client.id,
      status: BookingStatus.PENDING,
      paymentSelection: input.paymentSelection,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Client Adapter",
      customerEmail: client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
      ...(order ? { orderId: order.id } : {}),
    },
  });

  return { booking, client, price, product, classType };
}

describe("canonical booking->cart adapter (dark launch)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("maps SINGLE_SESSION booking into canonical cart line and metadata contract", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
      withOrder: true,
    });

    const result = await buildCanonicalBookingCartAdapterInput({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });

    expect(result.cartLines).toEqual([
      {
        productId: fixture.product.id,
        priceId: fixture.price.id,
        quantity: 1,
      },
    ]);
    expect(result.metadata).toMatchObject({
      bookingId: fixture.booking.id,
      serviceSlug: fixture.classType.slug,
      selection: BookingPaymentSelection.SINGLE_SESSION,
      userId: fixture.client.id,
      priceId: fixture.price.id,
      productId: fixture.product.id,
      orderId: fixture.booking.orderId ?? "",
      paymentId: "",
      source: "CART_CHECKOUT_V1",
      checkoutOrigin: "BOOKING",
    });
  });

  it("maps NEW_PLAN_PURCHASE booking into canonical cart line and metadata contract", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const result = await buildCanonicalBookingCartAdapterInput({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });

    expect(result.cartLines).toEqual([
      {
        productId: fixture.product.id,
        priceId: fixture.price.id,
        quantity: 1,
      },
    ]);
    expect(result.metadata.selection).toBe(BookingPaymentSelection.NEW_PLAN_PURCHASE);
    expect(result.metadata.orderId).toBe("");
    expect(result.metadata.paymentId).toBe("");
    expect(result.metadata.source).toBe("CART_CHECKOUT_V1");
    expect(result.metadata.checkoutOrigin).toBe("BOOKING");
  });

  it("returns AUTH_REQUIRED when userId is null", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: fixture.booking.id,
        userId: null,
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "AUTH_REQUIRED",
    });
  });

  it("returns AUTH_REQUIRED when requester does not own booking", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });
    const otherClient = await prisma.user.create({
      data: {
        name: "Other Client",
        email: `client.other.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });

    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: fixture.booking.id,
        userId: otherClient.id,
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "AUTH_REQUIRED",
    });
  });

  it("returns BOOKING_NOT_PENDING when booking status is not pending", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });
    await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { status: BookingStatus.CONFIRMED },
    });

    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: fixture.booking.id,
        userId: fixture.client.id,
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "BOOKING_NOT_PENDING",
    });
  });

  it("returns MISSING_PRICE when selected price is missing", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });
    await prisma.booking.update({
      where: { id: fixture.booking.id },
      data: { selectedPriceId: null },
    });

    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: fixture.booking.id,
        userId: fixture.client.id,
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "MISSING_PRICE",
    });
  });

  it("returns BOOKING_NOT_FOUND for unknown booking id", async () => {
    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: "booking_missing_12345678",
        userId: "user_12345678",
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("keeps idempotencyKey and clientCartVersion deterministic for repeated reads", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    const first = await buildCanonicalBookingCartAdapterInput({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });
    const second = await buildCanonicalBookingCartAdapterInput({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });

    expect(first.idempotencyKey).toBe(`bookcart_${fixture.booking.id}`);
    expect(first.clientCartVersion).toBe(`booking:${fixture.booking.id}`);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.clientCartVersion).toBe(first.clientCartVersion);
  });

  it("keeps EXISTING_PLAN off canonical adapter path and legacy booking checkout behavior unchanged", async () => {
    const fixture = await createBookingFixture({
      paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
    });

    await expect(
      buildCanonicalBookingCartAdapterInput({
        bookingId: fixture.booking.id,
        userId: fixture.client.id,
      }),
    ).rejects.toMatchObject<Partial<BookingCartAdapterError>>({
      code: "INVALID_SELECTION",
    });

    const reloadedBooking = await prisma.booking.findUnique({
      where: { id: fixture.booking.id },
      select: { checkoutPath: true, paymentSelection: true },
    });
    expect(reloadedBooking?.checkoutPath).toBeNull();
    expect(reloadedBooking?.paymentSelection).toBe(BookingPaymentSelection.EXISTING_PLAN);
  });
});
