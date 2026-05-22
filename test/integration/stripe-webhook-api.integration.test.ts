import "./helpers/setup-env";
import {
  BookingPaymentSelection,
  BookingStatus,
  CheckoutSource,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  StripeWebhookReceiptStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "./helpers/db";
import { createClassCategory, createClassType } from "./helpers/factories";
import { resetDb } from "./helpers/reset-db";
import {
  getBookingPaymentOptions,
  getMyActivePlans,
} from "../../src/lib/public-booking/booking-payment-options-service";
import { getDashboardMembershipData } from "../../src/lib/dashboard/dashboard-service";

const verifyStripeWebhookEventMock = vi.fn();
const retrieveCheckoutSessionMock = vi.fn();
const retrieveSubscriptionMock = vi.fn();

vi.mock("@/lib/payments/stripe", () => ({
  verifyStripeWebhookEvent: (...args: unknown[]) => {
    const event = verifyStripeWebhookEventMock(...args) as { id?: unknown; type?: unknown } | null | undefined;
    const id = typeof event?.id === "string" && event.id.length > 0 ? event.id : `evt_test_${Date.now()}`;
    return { ...event, id };
  },
  getStripeClient: () => ({
    checkout: {
      sessions: {
        retrieve: (...args: unknown[]) => retrieveCheckoutSessionMock(...args),
      },
    },
    subscriptions: {
      retrieve: (...args: unknown[]) => retrieveSubscriptionMock(...args),
    },
  }),
}));

import { POST as handleStripeWebhook } from "../../src/app/api/stripe/webhook/route";
import {
  getCheckoutSessionReconciliationState,
  reconcileCatalogCheckoutSessionAfterReturn,
  reconcileCheckoutSessionAfterReturn,
} from "../../src/lib/public-booking/stripe-webhook-service";

async function createWebhookFixture(input: {
  paymentSelection: BookingPaymentSelection;
  classPackGrantQuantity?: number;
}) {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: "yoga",
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher",
      email: `teacher.webhook.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Template",
      slug: `template-webhook-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(18, 0, 0, 0);
  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? "10-Class Pack" : "Drop-In",
      slug: `prod-webhook-${Date.now()}`,
      productType:
        input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
          ? ProductType.CLASS_PACK
          : ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `price-webhook-${Date.now()}`,
      name: "Standard",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE ? 15000 : 2200,
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
      quantity:
        input.paymentSelection === BookingPaymentSelection.NEW_PLAN_PURCHASE
          ? (input.classPackGrantQuantity ?? 10)
          : 1,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client",
      email: `client.webhook.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Webhook fixture order",
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: client.id,
      orderId: order.id,
      status: BookingStatus.PENDING,
      paymentSelection: input.paymentSelection,
      selectedPriceId: price.id,
      draftAmountMinor: price.unitAmountMinor,
      draftCurrencyCode: "EUR",
      customerName: "Client",
      customerEmail: client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_test_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { booking, payment, price, client, product, order };
}

async function createCatalogCheckoutFixture() {
  const category = await createClassCategory(prisma, {
    name: "Yoga",
    slug: `yoga-catalog-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Vinyasa",
    slug: `vinyasa-catalog-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Teacher Catalog",
      email: `teacher.catalog.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Catalog Template",
      slug: `template-catalog-${Date.now()}`,
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });
  const startsAt = new Date();
  startsAt.setUTCDate(startsAt.getUTCDate() + 3);
  startsAt.setUTCHours(18, 0, 0, 0);
  const studioSession = await prisma.studioSession.create({
    data: {
      classTemplateId: template.id,
      classTypeId: classType.id,
      teacherId: teacher.id,
      title: "Catalog Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 12,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Catalog 10-Class Pack",
      slug: `catalog-pack-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `catalog-pack-${Date.now()}`,
      name: "Catalog 10-Class Pack",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 15000,
      isActive: true,
      isArchived: false,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 10,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Catalog Client",
      email: `client.catalog.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Catalog checkout fixture order",
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_catalog_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: studioSession.id,
      clientId: client.id,
      status: BookingStatus.PENDING,
      customerName: "Catalog Client",
      customerEmail: client.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  return { client, product, price, order, payment, booking };
}

async function createRecurringCatalogCheckoutFixture() {
  const product = await prisma.product.create({
    data: {
      name: "Monthly Unlimited Collective",
      slug: `monthly-unlimited-${Date.now()}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `monthly-unlimited-price-${Date.now()}`,
      name: "Monthly Unlimited",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 12900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      stripePriceId: `price_monthly_${Date.now()}`,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: null,
      isActive: true,
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Recurring Client",
      email: `client.recurring.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Recurring catalog checkout fixture order",
    },
  });

  await prisma.orderItem.create({
    data: {
      orderId: order.id,
      productId: product.id,
      priceId: price.id,
      quantity: 1,
      productNameSnapshot: product.name,
      priceNameSnapshot: price.name,
      unitAmountMinor: price.unitAmountMinor,
      lineSubtotalAmountMinor: price.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: `cs_recurring_${Date.now()}`,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { client, product, price, order, payment };
}

async function createCartCheckoutMultiLineFixture() {
  const client = await prisma.user.create({
    data: {
      name: "Cart Multi Client",
      email: `client.cart.multi.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const firstProduct = await prisma.product.create({
    data: {
      name: "Cart Pack A",
      slug: `cart-pack-a-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });
  const secondProduct = await prisma.product.create({
    data: {
      name: "Cart Pack B",
      slug: `cart-pack-b-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 2,
    },
  });

  const firstPrice = await prisma.price.create({
    data: {
      productId: firstProduct.id,
      lookupKey: `cart-pack-a-price-${Date.now()}`,
      name: "Pack A",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
    },
  });
  const secondPrice = await prisma.price.create({
    data: {
      productId: secondProduct.id,
      lookupKey: `cart-pack-b-price-${Date.now()}`,
      name: "Pack B",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 3000,
      isActive: true,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: firstProduct.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 5,
      isActive: true,
    },
  });
  await prisma.entitlementRule.create({
    data: {
      productId: secondProduct.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 3,
      isActive: true,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: 11000,
      discountAmountMinor: 0,
      totalAmountMinor: 11000,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Cart multi-line fixture",
      items: {
        create: [
          {
            productId: firstProduct.id,
            priceId: firstPrice.id,
            quantity: 1,
            productNameSnapshot: firstProduct.name,
            priceNameSnapshot: firstPrice.name,
            unitAmountMinor: firstPrice.unitAmountMinor,
            lineSubtotalAmountMinor: firstPrice.unitAmountMinor,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: firstPrice.unitAmountMinor,
            currencyCode: "EUR",
          },
          {
            productId: secondProduct.id,
            priceId: secondPrice.id,
            quantity: 2,
            productNameSnapshot: secondProduct.name,
            priceNameSnapshot: secondPrice.name,
            unitAmountMinor: secondPrice.unitAmountMinor,
            lineSubtotalAmountMinor: secondPrice.unitAmountMinor * 2,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: secondPrice.unitAmountMinor * 2,
            currencyCode: "EUR",
          },
        ],
      },
    },
    select: { id: true },
  });

  const checkoutSessionId = `cs_cart_multi_${Date.now()}`;
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: 11000,
      currencyCode: "EUR",
    },
  });

  return { client, order, payment, firstProduct, secondProduct, firstPrice, secondPrice, checkoutSessionId };
}

async function createCartCheckoutSameProductMultiLineFixture() {
  const client = await prisma.user.create({
    data: {
      name: "Cart Same Product Client",
      email: `client.cart.same-product.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Cart Same Product Pack",
      slug: `cart-same-product-${Date.now()}`,
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const firstPrice = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `cart-same-product-price-a-${Date.now()}`,
      name: "Pack A",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
    },
  });
  const secondPrice = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `cart-same-product-price-b-${Date.now()}`,
      name: "Pack B",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 7000,
      isActive: false,
      isArchived: false,
    },
  });

  await prisma.entitlementRule.create({
    data: {
      productId: product.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      quantity: 5,
      isActive: true,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: firstPrice.unitAmountMinor + secondPrice.unitAmountMinor * 2,
      discountAmountMinor: 0,
      totalAmountMinor: firstPrice.unitAmountMinor + secondPrice.unitAmountMinor * 2,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Cart same-product multi-line fixture",
      items: {
        create: [
          {
            productId: product.id,
            priceId: firstPrice.id,
            quantity: 1,
            productNameSnapshot: product.name,
            priceNameSnapshot: firstPrice.name,
            unitAmountMinor: firstPrice.unitAmountMinor,
            lineSubtotalAmountMinor: firstPrice.unitAmountMinor,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: firstPrice.unitAmountMinor,
            currencyCode: "EUR",
          },
          {
            productId: product.id,
            priceId: secondPrice.id,
            quantity: 2,
            productNameSnapshot: product.name,
            priceNameSnapshot: secondPrice.name,
            unitAmountMinor: secondPrice.unitAmountMinor,
            lineSubtotalAmountMinor: secondPrice.unitAmountMinor * 2,
            lineDiscountAmountMinor: 0,
            lineTotalAmountMinor: secondPrice.unitAmountMinor * 2,
            currencyCode: "EUR",
          },
        ],
      },
    },
    select: { id: true },
  });

  const checkoutSessionId = `cs_cart_same_product_${Date.now()}`;
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: firstPrice.unitAmountMinor + secondPrice.unitAmountMinor * 2,
      currencyCode: "EUR",
    },
  });

  return { client, product, order, payment, firstPrice, secondPrice, checkoutSessionId };
}

async function createCartRecurringCheckoutFixture() {
  const client = await prisma.user.create({
    data: {
      name: "Cart Recurring Client",
      email: `client.cart.recurring.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const product = await prisma.product.create({
    data: {
      name: "Cart Recurring Product",
      slug: `cart-recurring-${Date.now()}`,
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
    },
  });

  const price = await prisma.price.create({
    data: {
      productId: product.id,
      lookupKey: `cart-recurring-price-${Date.now()}`,
      name: "Cart Recurring Price",
      priceType: PriceType.RECURRING,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      currencyCode: "EUR",
      unitAmountMinor: 12900,
      stripePriceId: `price_cart_recurring_${Date.now()}`,
      isActive: true,
      isArchived: false,
    },
  });

  const order = await prisma.order.create({
    data: {
      clientId: client.id,
      subtotalAmountMinor: price.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      notes: "Cart recurring fixture",
      items: {
        create: {
          productId: product.id,
          priceId: price.id,
          quantity: 1,
          productNameSnapshot: product.name,
          priceNameSnapshot: price.name,
          unitAmountMinor: price.unitAmountMinor,
          lineSubtotalAmountMinor: price.unitAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: price.unitAmountMinor,
          currencyCode: "EUR",
        },
      },
    },
    select: { id: true },
  });

  const checkoutSessionId = `cs_cart_recurring_${Date.now()}`;
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
      amountMinor: price.unitAmountMinor,
      currencyCode: "EUR",
    },
  });

  return { client, product, price, order, payment, checkoutSessionId };
}

async function createBookingOnlyPaymentFixture() {
  const category = await createClassCategory(prisma, {
    name: "Booking-only Category",
    slug: `booking-only-cat-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
  });
  const classType = await createClassType(prisma, {
    categoryId: category.id,
    name: "Booking-only Class",
    slug: `booking-only-class-${Date.now()}`,
    sortOrder: 1,
    isActive: true,
    isVisible: true,
  });
  const teacher = await prisma.user.create({
    data: {
      name: "Booking-only Teacher",
      email: `teacher.booking-only.${Date.now()}@example.test`,
      role: Role.TEACHER,
    },
  });
  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Booking-only Template",
      slug: `booking-only-template-${Date.now()}`,
      defaultCapacity: 10,
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
      title: "Booking-only Session",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: 10,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });

  const owner = await prisma.user.create({
    data: {
      name: "Booking Owner",
      email: `booking.owner.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });
  const otherUser = await prisma.user.create({
    data: {
      name: "Booking Other User",
      email: `booking.other.${Date.now()}@example.test`,
      role: Role.CLIENT,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      studioSessionId: session.id,
      clientId: owner.id,
      status: BookingStatus.PENDING,
      customerName: owner.name,
      customerEmail: owner.email,
      customerPhone: "+32000000000",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
      consentAcceptedAt: new Date(),
    },
  });

  const checkoutSessionId = `cs_booking_only_${Date.now()}`;
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: checkoutSessionId,
      stripeCheckoutSessionId: checkoutSessionId,
      amountMinor: 2200,
      currencyCode: "EUR",
    },
  });

  return { owner, otherUser, booking, payment, checkoutSessionId };
}
describe("POST /api/stripe/webhook", () => {
  beforeEach(async () => {
    verifyStripeWebhookEventMock.mockReset();
    retrieveCheckoutSessionMock.mockReset();
    retrieveSubscriptionMock.mockReset();
    await resetDb();
  });

  it("confirms booking, payment, and order for single-session checkout", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment?.orderId).toBe(fixture.order.id);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
  });

  it("activates entitlement and confirms booking for plan purchase (idempotent)", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const request = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig_test" },
      body: "{}",
    });

    const responseOne = await handleStripeWebhook(request);
    expect(responseOne.status).toBe(200);

    const responseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseTwo.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    const creditBalance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      _sum: { amount: true },
    });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
    expect(booking?.selectedEntitlementId).toBeTruthy();
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0]?.orderId).toBe(fixture.order.id);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
    expect(creditBalance._sum.amount).toBe(9);
  });

  it("grants configured class-pack credit quantity from entitlement rule on purchase", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
      classPackGrantQuantity: 6,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
      select: { id: true },
    });
    const balance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlement?.id,
      },
      _sum: { amount: true },
    });

    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
    expect(balance._sum.amount).toBe(5);
  });

  it("marks payment and order failed/cancelled when checkout expires", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {},
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });

  it("marks booking-flow payment failed by stripeCheckoutSessionId when providerReference differs", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });
    const checkoutSessionId = `cs_booking_expire_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        providerReference: `pi_booking_expire_${Date.now()}`,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "booking-flow" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
  });

  it("marks booking-flow payment failed on async_payment_failed by stripeCheckoutSessionId when providerReference differs", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });
    const checkoutSessionId = `cs_booking_async_fail_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        providerReference: `pi_booking_async_fail_${Date.now()}`,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "booking-flow" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
  });

  it("marks payment failed and order cancelled on async payment failure", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {},
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });

  it("does not confirm booking when checkout.session.completed is unpaid", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "unpaid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    const entitlements = await prisma.clientEntitlement.count({ where: { clientId: fixture.client.id } });

    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(entitlements).toBe(0);
  });

  it("rejects missing stripe signature", async () => {
    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);
  });
  it("handles completed checkout with missing metadata by leaving unmatched records unchanged", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_missing_metadata_unmatched",
          payment_status: "paid",
          metadata: {},
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
  });

  it("handles invalid metadata identifiers without mutating unrelated records", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: "payment_does_not_exist",
            bookingId: "booking_does_not_exist",
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
  });
  it("keeps stable state across replayed completed events followed by expired", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const completedEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    const completedResponseOne = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedResponseOne.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    const completedResponseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedResponseTwo.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            orderId: fixture.order.id,
          },
        },
      },
    });
    const expiredResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(expiredResponse.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
      },
    });

    const relatedPayments = await prisma.payment.findMany({
      where: {
        bookingId: fixture.booking.id,
        provider: PaymentProvider.STRIPE,
      },
    });
    const relatedOrders = await prisma.order.findMany({
      where: {
        bookings: {
          some: {
            id: fixture.booking.id,
          },
        },
      },
    });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);

    expect(entitlements).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);

    expect(relatedPayments).toHaveLength(1);
    expect(relatedOrders).toHaveLength(1);
  });

  it("keeps finalized checkout state stable when async payment failed arrives late", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const completedEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    const completedResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedResponse.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            orderId: fixture.order.id,
          },
        },
      },
    });
    const failedResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(failedResponse.status).toBe(200);

    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
  });
  it("activates catalog purchase entitlements and exposes them in booking payment options", async () => {
    const fixture = await createCatalogCheckoutFixture();

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(0);

    const plans = await getMyActivePlans(fixture.client.id);
    expect(plans.some((plan) => plan.productId === fixture.product.id && (plan.remainingCredits ?? 0) > 0)).toBe(true);

    const paymentOptions = await getBookingPaymentOptions({
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });

    expect(
      paymentOptions.existingPlans.some(
        (plan) =>
          plan.productId === fixture.product.id &&
          plan.entitlementId === entitlements[0]?.id &&
          (plan.remainingCredits ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it("membership and booking plan purchases create equivalent active entitlement sources", async () => {
    const membershipFixture = await createCatalogCheckoutFixture();
    const bookingFixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          id: membershipFixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: membershipFixture.payment.id,
            orderId: membershipFixture.order.id,
            userId: membershipFixture.client.id,
            productId: membershipFixture.product.id,
            priceId: membershipFixture.price.id,
            selectedPriceId: membershipFixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const membershipResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(membershipResponse.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce({
      type: "checkout.session.completed",
      data: {
        object: {
          id: bookingFixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: bookingFixture.payment.id,
            bookingId: bookingFixture.booking.id,
            selectedPriceId: bookingFixture.price.id,
            orderId: bookingFixture.order.id,
          },
        },
      },
    });

    const bookingResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(bookingResponse.status).toBe(200);

    const membershipEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: membershipFixture.client.id, productId: membershipFixture.product.id },
      select: { entitlementType: true, entitlementScope: true, status: true, id: true },
    });
    const bookingEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: bookingFixture.client.id, productId: bookingFixture.product.id },
      select: { entitlementType: true, entitlementScope: true, status: true, id: true },
    });

    expect(membershipEntitlement?.status).toBe(ClientEntitlementStatus.ACTIVE);
    expect(bookingEntitlement?.status).toBe(ClientEntitlementStatus.ACTIVE);
    expect(membershipEntitlement?.entitlementType).toBe(bookingEntitlement?.entitlementType);
    expect(membershipEntitlement?.entitlementScope).toBe(bookingEntitlement?.entitlementScope);

    const membershipBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: membershipFixture.client.id, entitlementId: membershipEntitlement?.id },
      _sum: { amount: true },
    });
    const bookingBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: bookingFixture.client.id, entitlementId: bookingEntitlement?.id },
      _sum: { amount: true },
    });

    expect((membershipBalance._sum.amount ?? 0) > 0).toBe(true);
    expect((bookingBalance._sum.amount ?? 0) > 0).toBe(true);
  });

  it("reflects fulfilled class-pack purchase in dashboard active packs and credits", async () => {
    const fixture = await createCatalogCheckoutFixture();

    const beforeFulfillment = await getDashboardMembershipData(fixture.client.id);
    expect(beforeFulfillment.ownedOneTimeProducts).toHaveLength(0);
    expect(beforeFulfillment.activeCreditPacks).toHaveLength(0);
    expect(beforeFulfillment.usableCredits).toBe(0);

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const membership = await getDashboardMembershipData(fixture.client.id);

    expect(membership.usableCredits).toBe(10);
    expect(membership.activeCreditPacks).toHaveLength(1);
    expect(membership.activeCreditPacks[0]?.productName).toBe(fixture.product.name);
    expect(membership.ownedOneTimeProducts).toHaveLength(1);
  });

  it("reflects fulfilled recurring subscription purchase in dashboard subscription state", async () => {
    const fixture = await createRecurringCatalogCheckoutFixture();

    retrieveSubscriptionMock.mockResolvedValue({
      id: "sub_dashboard_test",
      status: "active",
      start_date: Math.floor(Date.now() / 1000) - 60,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      items: {
        data: [
          {
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            price: { id: fixture.price.stripePriceId },
          },
        ],
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          mode: "subscription",
          subscription: "sub_dashboard_test",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const membership = await getDashboardMembershipData(fixture.client.id);

    expect(membership.activeSubscription?.productName).toBe(fixture.product.name);
    expect(
      membership.recurringSubscriptions.some((subscription) => subscription.productId === fixture.product.id),
    ).toBe(true);
    expect(membership.usableCredits).toBe(0);
    expect(membership.activeCreditPacks).toHaveLength(0);
  });
  it("handles concurrent duplicate checkout completion deliveries without duplicate grants", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            bookingId: fixture.booking.id,
            selectedPriceId: fixture.price.id,
            orderId: fixture.order.id,
          },
        },
      },
    });

    await Promise.all(
      Array.from({ length: 8 }).map(() =>
        handleStripeWebhook(
          new Request("http://localhost/api/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": "sig_test" },
            body: "{}",
          }),
        ),
      ),
    );

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        orderId: fixture.order.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const entries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
  });

  it("rejects invalid stripe signature with no DB mutation", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
    });

    verifyStripeWebhookEventMock.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "bad_sig" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(400);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const booking = await prisma.booking.findUnique({ where: { id: fixture.booking.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PLACED);
  });

  it("does not duplicate fulfillment when recovery runs after a successful webhook", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });

    const checkoutSessionId = fixture.payment.providerReference;

    const checkoutSession = {
      id: checkoutSessionId,
      payment_status: "paid",
      mode: "payment",
      payment_intent: "pi_reconcile_success",
      customer: "cus_reconcile_success",
      metadata: {
        paymentId: fixture.payment.id,
        bookingId: fixture.booking.id,
        selectedPriceId: fixture.price.id,
        orderId: fixture.order.id,
      },
    };

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: checkoutSession },
    });

    const webhookResponse = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(webhookResponse.status).toBe(200);

    const finalizedPayment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    expect(finalizedPayment?.providerReference).toBe("pi_reconcile_success");
    expect(finalizedPayment?.stripeCheckoutSessionId).toBe(checkoutSessionId);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    retrieveCheckoutSessionMock.mockResolvedValue(checkoutSession);
    await reconcileCheckoutSessionAfterReturn({
      checkoutSessionId,
      bookingId: fixture.booking.id,
      userId: fixture.client.id,
    });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        orderId: fixture.order.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });
    expect(entitlements).toHaveLength(1);

    const entries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(entries.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(1);
  });

  it("keeps catalog finalization idempotent when checkout completion is replayed", async () => {
    const fixture = await createCatalogCheckoutFixture();

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.payment.providerReference,
          payment_status: "paid",
          metadata: {
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: fixture.product.id,
            priceId: fixture.price.id,
            selectedPriceId: fixture.price.id,
            source: "subscription-catalog",
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    const responseOne = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseOne.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    const responseTwo = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(responseTwo.status).toBe(200);

    const entitlements = await prisma.clientEntitlement.findMany({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        status: ClientEntitlementStatus.ACTIVE,
      },
    });

    expect(entitlements).toHaveLength(1);

    const credits = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
    });

    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.GRANT)).toHaveLength(1);
    expect(credits.filter((entry) => entry.entryType === CreditLedgerEntryType.CONSUME)).toHaveLength(0);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlements[0]?.id,
      },
      _sum: { amount: true },
    });

    expect(balance._sum.amount).toBe(10);
  });

  it("finalizes cart-source multi-line checkout from persisted local order items", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "subscription-catalog",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: "wrong_product_id",
            priceId: "wrong_price_id",
            selectedPriceId: "wrong_price_id",
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true, checkoutSource: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(order?.status).toBe(OrderStatus.PAID);

    const firstEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: fixture.client.id, productId: fixture.firstProduct.id, orderId: fixture.order.id },
    });
    const secondEntitlement = await prisma.clientEntitlement.findFirst({
      where: { clientId: fixture.client.id, productId: fixture.secondProduct.id, orderId: fixture.order.id },
    });
    expect(firstEntitlement).toBeTruthy();
    expect(secondEntitlement).toBeTruthy();

    const firstBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: fixture.client.id, entitlementId: firstEntitlement?.id },
      _sum: { amount: true },
    });
    const secondBalance = await prisma.creditLedgerEntry.aggregate({
      where: { clientId: fixture.client.id, entitlementId: secondEntitlement?.id },
      _sum: { amount: true },
    });
    expect(firstBalance._sum.amount).toBe(5);
    expect(secondBalance._sum.amount).toBe(6);
  });

  it("keeps cart-source fulfillment idempotent on replayed checkout.session.completed events", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "subscription-catalog",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
            productId: "wrong_product_id",
            priceId: "wrong_price_id",
            selectedPriceId: "wrong_price_id",
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    verifyStripeWebhookEventMock.mockReturnValueOnce(event);

    const first = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    const second = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const entitlements = await prisma.clientEntitlement.findMany({
      where: { clientId: fixture.client.id, orderId: fixture.order.id },
    });
    expect(entitlements).toHaveLength(2);

    const grantEntries = await prisma.creditLedgerEntry.findMany({
      where: { clientId: fixture.client.id, entryType: CreditLedgerEntryType.GRANT },
    });
    expect(grantEntries).toHaveLength(2);
  });

  it("uses local payment/order for cart manual reconciliation even without catalog metadata", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    retrieveCheckoutSessionMock.mockResolvedValue({
      id: fixture.checkoutSessionId,
      payment_status: "paid",
      mode: "payment",
      payment_intent: "pi_cart_manual_reconcile",
      customer: "cus_cart_manual_reconcile",
      metadata: {
        source: "CART_CHECKOUT_V1",
        paymentId: fixture.payment.id,
        orderId: fixture.order.id,
        userId: fixture.client.id,
      },
    });

    await reconcileCatalogCheckoutSessionAfterReturn({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true, checkoutSource: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(order?.status).toBe(OrderStatus.PAID);
  });

  it("marks cart-source payment/order failed on checkout.session.expired", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
  });

  it("publishes reconciliation state for checkout session", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    const pendingState = await getCheckoutSessionReconciliationState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });
    expect(pendingState.reconciliationState).toBe("PENDING");

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "CART_CHECKOUT_V1",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
          },
        },
      },
    });
    await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    const confirmedState = await getCheckoutSessionReconciliationState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });
    expect(confirmedState.reconciliationState).toBe("CONFIRMED");
    expect(confirmedState.paymentStatus).toBe(PaymentStatus.SUCCEEDED);
    expect(confirmedState.orderStatus).toBe(OrderStatus.PAID);
  });

  it("does not reconstruct cart-source checkout from metadata when no local payment/order exists", async () => {
    const client = await prisma.user.create({
      data: {
        name: "No Local Cart User",
        email: `no.local.cart.${Date.now()}@example.test`,
        role: Role.CLIENT,
      },
    });
    const product = await prisma.product.create({
      data: {
        name: "No Local Cart Product",
        slug: `no-local-cart-product-${Date.now()}`,
        productType: ProductType.CLASS_PACK,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
    });
    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: `no-local-cart-price-${Date.now()}`,
        name: "No Local Cart Price",
        priceType: PriceType.ONE_TIME,
        currencyCode: "EUR",
        unitAmountMinor: 5000,
        isActive: true,
        isArchived: false,
      },
    });

    const beforeOrderCount = await prisma.order.count({ where: { clientId: client.id } });
    const beforePaymentCount = await prisma.payment.count({
      where: { order: { clientId: client.id } },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_no_local_cart_${Date.now()}`,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "CART_CHECKOUT_V1",
            userId: client.id,
            productId: product.id,
            priceId: price.id,
            selectedPriceId: price.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const afterOrderCount = await prisma.order.count({ where: { clientId: client.id } });
    const afterPaymentCount = await prisma.payment.count({
      where: { order: { clientId: client.id } },
    });
    expect(afterOrderCount).toBe(beforeOrderCount);
    expect(afterPaymentCount).toBe(beforePaymentCount);
  });

  it("rejects manual catalog reconciliation for booking-only local payment owned by another user", async () => {
    const fixture = await createBookingOnlyPaymentFixture();

    retrieveCheckoutSessionMock.mockResolvedValue({
      id: fixture.checkoutSessionId,
      payment_status: "paid",
      mode: "payment",
      payment_intent: "pi_booking_only_manual",
      customer: "cus_booking_only_manual",
      metadata: {
        source: "CART_CHECKOUT_V1",
        paymentId: fixture.payment.id,
        bookingId: fixture.booking.id,
        userId: fixture.owner.id,
      },
    });

    await reconcileCatalogCheckoutSessionAfterReturn({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.otherUser.id,
    });

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true },
    });
    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(retrieveCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("enforces active-subscription guard for cart-source recurring webhook completion", async () => {
    const fixture = await createCartRecurringCheckoutFixture();

    await prisma.subscriptionContract.create({
      data: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        priceId: fixture.price.id,
        status: "ACTIVE",
        startsAt: new Date(Date.now() - 60 * 1000),
        currentPeriodStart: new Date(Date.now() - 60 * 1000),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: `sub_existing_cart_guard_${Date.now()}`,
      },
    });

    retrieveSubscriptionMock.mockResolvedValue({
      id: "sub_cart_guard_new",
      status: "active",
      start_date: Math.floor(Date.now() / 1000) - 60,
      cancel_at_period_end: false,
      canceled_at: null,
      ended_at: null,
      items: {
        data: [
          {
            current_period_start: Math.floor(Date.now() / 1000) - 60,
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
            price: { id: fixture.price.stripePriceId },
          },
        ],
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          payment_status: "paid",
          mode: "subscription",
          subscription: "sub_cart_guard_new",
          metadata: {
            source: "CART_CHECKOUT_V1",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
          },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const contracts = await prisma.subscriptionContract.findMany({
      where: { clientId: fixture.client.id },
    });
    expect(contracts).toHaveLength(1);
    expect(contracts[0]?.providerSubscriptionReference).not.toBe("sub_cart_guard_new");
  });

  it("grants same-product multi-line cart credits correctly and remains replay-idempotent", async () => {
    const fixture = await createCartCheckoutSameProductMultiLineFixture();

    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "CART_CHECKOUT_V1",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            userId: fixture.client.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(event);
    verifyStripeWebhookEventMock.mockReturnValueOnce(event);

    const first = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    const second = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        clientId: fixture.client.id,
        productId: fixture.product.id,
        orderId: fixture.order.id,
      },
    });
    expect(entitlement).toBeTruthy();

    const grants = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlement?.id,
        entryType: CreditLedgerEntryType.GRANT,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(grants).toHaveLength(2);

    const balance = await prisma.creditLedgerEntry.aggregate({
      where: {
        clientId: fixture.client.id,
        entitlementId: entitlement?.id,
      },
      _sum: { amount: true },
    });
    expect(balance._sum.amount).toBe(15);
  });

  it("returns FAILED reconciliation state after cart-source checkout expiration", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: fixture.checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });
    await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );

    const failedState = await getCheckoutSessionReconciliationState({
      checkoutSessionId: fixture.checkoutSessionId,
      userId: fixture.client.id,
    });
    expect(failedState.reconciliationState).toBe("FAILED");
    expect(failedState.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(failedState.orderStatus).toBe(OrderStatus.CANCELLED);
  });

  it("keeps NEW_PLAN_PURCHASE cart-source state stable across replayed completed then delayed expired", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });
    const checkoutSessionId = `cs_cart_new_plan_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        providerReference: checkoutSessionId,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    const completedEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "CART_CHECKOUT_V1",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            bookingId: fixture.booking.id,
            userId: fixture.client.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);

    const completedFirst = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    const completedReplay = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedFirst.status).toBe(200);
    expect(completedReplay.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const delayedExpired = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(delayedExpired.status).toBe(200);

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true, checkoutSource: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    const booking = await prisma.booking.findUnique({
      where: { id: fixture.booking.id },
      select: { status: true },
    });
    const grantEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        orderId: fixture.order.id,
        entryType: CreditLedgerEntryType.GRANT,
      },
    });

    expect(payment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
    expect(grantEntries).toHaveLength(1);
  });

  it("keeps NEW_PLAN_PURCHASE cart-source state stable across replayed completed then delayed async_payment_failed", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });
    const checkoutSessionId = `cs_cart_new_plan_async_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        providerReference: checkoutSessionId,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    const completedEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: checkoutSessionId,
          payment_status: "paid",
          mode: "payment",
          metadata: {
            source: "CART_CHECKOUT_V1",
            paymentId: fixture.payment.id,
            orderId: fixture.order.id,
            bookingId: fixture.booking.id,
            userId: fixture.client.id,
          },
        },
      },
    };

    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);
    verifyStripeWebhookEventMock.mockReturnValueOnce(completedEvent);

    const completedFirst = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    const completedReplay = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(completedFirst.status).toBe(200);
    expect(completedReplay.status).toBe(200);

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const delayedAsyncFailed = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(delayedAsyncFailed.status).toBe(200);

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true, checkoutSource: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    const booking = await prisma.booking.findUnique({
      where: { id: fixture.booking.id },
      select: { status: true },
    });
    const grantEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        orderId: fixture.order.id,
        entryType: CreditLedgerEntryType.GRANT,
      },
    });

    expect(payment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(payment?.status).toBe(PaymentStatus.SUCCEEDED);
    expect(order?.status).toBe(OrderStatus.PAID);
    expect(booking?.status).toBe(BookingStatus.CONFIRMED);
    expect(grantEntries).toHaveLength(1);
  });

  it("marks NEW_PLAN_PURCHASE cart-source payment failed when expired arrives before any completed event", async () => {
    const fixture = await createWebhookFixture({
      paymentSelection: BookingPaymentSelection.NEW_PLAN_PURCHASE,
    });
    const checkoutSessionId = `cs_cart_new_plan_expired_first_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        checkoutSource: CheckoutSource.CART_CHECKOUT_V1,
        providerReference: `pi_cart_new_plan_expired_first_${Date.now()}`,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({
      where: { id: fixture.payment.id },
      select: { status: true, checkoutSource: true },
    });
    const order = await prisma.order.findUnique({
      where: { id: fixture.order.id },
      select: { status: true },
    });
    const booking = await prisma.booking.findUnique({
      where: { id: fixture.booking.id },
      select: { status: true },
    });
    const grantEntries = await prisma.creditLedgerEntry.findMany({
      where: {
        clientId: fixture.client.id,
        orderId: fixture.order.id,
        entryType: CreditLedgerEntryType.GRANT,
      },
    });

    expect(payment?.checkoutSource).toBe(CheckoutSource.CART_CHECKOUT_V1);
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(booking?.status).toBe(BookingStatus.PENDING);
    expect(grantEntries).toHaveLength(0);
  });

  it("marks cart-source payment failed by stripeCheckoutSessionId when providerReference differs", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();
    const checkoutSessionId = `cs_cart_expire_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        providerReference: `pi_cart_expire_${Date.now()}`,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.expired",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
  });

  it("marks cart-source payment failed on async_payment_failed by stripeCheckoutSessionId when providerReference differs", async () => {
    const fixture = await createCartCheckoutMultiLineFixture();
    const checkoutSessionId = `cs_cart_async_fail_${Date.now()}`;

    await prisma.payment.update({
      where: { id: fixture.payment.id },
      data: {
        providerReference: `pi_cart_async_fail_${Date.now()}`,
        stripeCheckoutSessionId: checkoutSessionId,
      },
    });

    verifyStripeWebhookEventMock.mockReturnValue({
      type: "checkout.session.async_payment_failed",
      data: {
        object: {
          id: checkoutSessionId,
          metadata: { source: "CART_CHECKOUT_V1" },
        },
      },
    });

    const response = await handleStripeWebhook(
      new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "sig_test" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUnique({ where: { id: fixture.payment.id } });
    const order = await prisma.order.findUnique({ where: { id: fixture.order.id } });
    expect(payment?.status).toBe(PaymentStatus.FAILED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);
  });

  describe("webhook dedupe", () => {
    it("duplicate replay is a no-op (PROCESSED receipt blocks re-execution)", async () => {
      const fixture = await createWebhookFixture({ paymentSelection: BookingPaymentSelection.SINGLE_SESSION });

      const event = {
        id: `evt_dedupe_${Date.now()}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: fixture.payment.providerReference,
            payment_status: "paid",
            mode: "payment",
            metadata: { paymentId: fixture.payment.id },
            payment_intent: null,
            customer: null,
            subscription: null,
            amount_total: fixture.price.unitAmountMinor,
            currency: "eur",
          },
        },
      };

      verifyStripeWebhookEventMock.mockReturnValue(event);

      const makeRequest = () =>
        handleStripeWebhook(
          new Request("http://localhost/api/stripe/webhook", {
            method: "POST",
            headers: { "stripe-signature": "sig_test" },
            body: "{}",
          }),
        );

      const res1 = await makeRequest();
      const res2 = await makeRequest();

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
        where: { eventId: event.id },
        select: { status: true },
      });
      expect(receipt?.status).toBe(StripeWebhookReceiptStatus.PROCESSED);

      const payments = await prisma.payment.findMany({
        where: { id: fixture.payment.id },
        select: { status: true },
      });
      expect(payments[0]?.status).toBe(PaymentStatus.SUCCEEDED);
    });

    it("stale PROCESSING receipt is reclaimed and re-processed", async () => {
      const fixture = await createWebhookFixture({ paymentSelection: BookingPaymentSelection.SINGLE_SESSION });
      const eventId = `evt_stale_${Date.now()}`;

      const staleDate = new Date(Date.now() - 15 * 60 * 1000);
      await prisma.stripeWebhookEventReceipt.create({
        data: {
          eventId,
          status: StripeWebhookReceiptStatus.PROCESSING,
          updatedAt: staleDate,
        },
      });

      verifyStripeWebhookEventMock.mockReturnValue({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: fixture.payment.providerReference,
            payment_status: "paid",
            mode: "payment",
            metadata: { paymentId: fixture.payment.id },
            payment_intent: null,
            customer: null,
            subscription: null,
            amount_total: fixture.price.unitAmountMinor,
            currency: "eur",
          },
        },
      });

      const res = await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);

      const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
        where: { eventId },
        select: { status: true },
      });
      expect(receipt?.status).toBe(StripeWebhookReceiptStatus.PROCESSED);
    });

    it("sets RETRYABLE_FAILED on processing error", async () => {
      const eventId = `evt_error_${Date.now()}`;

      verifyStripeWebhookEventMock.mockReturnValue({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_will_error",
            payment_status: "paid",
            mode: "payment",
            metadata: {},
            payment_intent: null,
            customer: null,
            subscription: null,
            amount_total: null,
            currency: "eur",
          },
        },
      });

      retrieveCheckoutSessionMock.mockRejectedValue(new Error("stripe_down"));

      const res = await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(500);

      const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
        where: { eventId },
        select: { status: true },
      });
      expect(receipt?.status).toBe(StripeWebhookReceiptStatus.RETRYABLE_FAILED);
    });

    it("RETRYABLE_FAILED receipt is retried on next webhook delivery", async () => {
      const fixture = await createWebhookFixture({ paymentSelection: BookingPaymentSelection.SINGLE_SESSION });
      const eventId = `evt_retry_${Date.now()}`;

      await prisma.stripeWebhookEventReceipt.create({
        data: {
          eventId,
          status: StripeWebhookReceiptStatus.RETRYABLE_FAILED,
        },
      });

      verifyStripeWebhookEventMock.mockReturnValue({
        id: eventId,
        type: "checkout.session.completed",
        data: {
          object: {
            id: fixture.payment.providerReference,
            payment_status: "paid",
            mode: "payment",
            metadata: { paymentId: fixture.payment.id },
            payment_intent: null,
            customer: null,
            subscription: null,
            amount_total: fixture.price.unitAmountMinor,
            currency: "eur",
          },
        },
      });

      const res = await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);

      const receipt = await prisma.stripeWebhookEventReceipt.findUnique({
        where: { eventId },
        select: { status: true },
      });
      expect(receipt?.status).toBe(StripeWebhookReceiptStatus.PROCESSED);
    });
  });

  describe("invoice.payment_failed handling", () => {
    async function createSubscriptionFixture() {
      const client = await prisma.user.create({
        data: {
          name: "Sub Client",
          email: `sub.client.${Date.now()}@example.test`,
          role: Role.CLIENT,
        },
      });
      const product = await prisma.product.create({
        data: {
          name: "Monthly Membership",
          slug: `membership-${Date.now()}`,
          productType: ProductType.UNLIMITED_MEMBERSHIP,
          isActive: true,
          isArchived: false,
          sortOrder: 1,
        },
      });
      const price = await prisma.price.create({
        data: {
          productId: product.id,
          lookupKey: `membership-price-${Date.now()}`,
          name: "Monthly",
          priceType: PriceType.RECURRING,
          currencyCode: "EUR",
          unitAmountMinor: 4900,
          billingInterval: "MONTH",
          billingIntervalCount: 1,
          isActive: true,
          isArchived: false,
        },
      });
      const stripeSubscriptionId = `sub_test_${Date.now()}`;
      const contract = await prisma.subscriptionContract.create({
        data: {
          clientId: client.id,
          productId: product.id,
          priceId: price.id,
          status: SubscriptionStatus.ACTIVE,
          startsAt: new Date(),
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          provider: PaymentProvider.STRIPE,
          providerSubscriptionReference: stripeSubscriptionId,
        },
      });
      return { client, product, price, contract, stripeSubscriptionId };
    }

    it("marks contract PAST_DUE when invoice.payment_failed and contract is PENDING", async () => {
      const { contract, stripeSubscriptionId } = await createSubscriptionFixture();
      await prisma.subscriptionContract.update({
        where: { id: contract.id },
        data: { status: SubscriptionStatus.PENDING },
      });

      verifyStripeWebhookEventMock.mockReturnValue({
        id: `evt_inv_${Date.now()}`,
        type: "invoice.payment_failed",
        data: {
          object: {
            id: `inv_${Date.now()}`,
            subscription: stripeSubscriptionId,
          },
        },
      });

      const res = await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );
      expect(res.status).toBe(200);

      const updated = await prisma.subscriptionContract.findUnique({
        where: { id: contract.id },
        select: { status: true },
      });
      expect(updated?.status).toBe(SubscriptionStatus.PAST_DUE);
    });

    it("ignores invoice.payment_failed when contract is already ACTIVE", async () => {
      const { contract, stripeSubscriptionId } = await createSubscriptionFixture();

      verifyStripeWebhookEventMock.mockReturnValue({
        id: `evt_inv_active_${Date.now()}`,
        type: "invoice.payment_failed",
        data: {
          object: {
            id: `inv_active_${Date.now()}`,
            subscription: stripeSubscriptionId,
          },
        },
      });

      await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );

      const unchanged = await prisma.subscriptionContract.findUnique({
        where: { id: contract.id },
        select: { status: true },
      });
      expect(unchanged?.status).toBe(SubscriptionStatus.ACTIVE);
    });

    it("ignores invoice.payment_failed when contract is CANCELLED", async () => {
      const { contract, stripeSubscriptionId } = await createSubscriptionFixture();
      await prisma.subscriptionContract.update({
        where: { id: contract.id },
        data: { status: SubscriptionStatus.CANCELLED },
      });

      verifyStripeWebhookEventMock.mockReturnValue({
        id: `evt_inv_cancelled_${Date.now()}`,
        type: "invoice.payment_failed",
        data: {
          object: {
            id: `inv_cancelled_${Date.now()}`,
            subscription: stripeSubscriptionId,
          },
        },
      });

      await handleStripeWebhook(
        new Request("http://localhost/api/stripe/webhook", {
          method: "POST",
          headers: { "stripe-signature": "sig_test" },
          body: "{}",
        }),
      );

      const unchanged = await prisma.subscriptionContract.findUnique({
        where: { id: contract.id },
        select: { status: true },
      });
      expect(unchanged?.status).toBe(SubscriptionStatus.CANCELLED);
    });
  });

});
