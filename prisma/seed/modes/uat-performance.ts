/**
 * UAT Performance seed mode — for k6/load/performance testing only.
 * All users have @bookmyclass-perf.local emails, isolated from dev and production data.
 * Generates 120 days of future sessions with dense pre-booked patterns.
 */

import {
  BillingInterval,
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
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
  ServicePricingMode,
  StripeCheckoutMode,
  StripeSyncStatus,
  StudioSessionStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import prisma from "../../../src/lib/db";
import { AGENDA_SCHEDULE } from "../data/schedule";
import { createSeededRng } from "../utils/deterministic-random";
import {
  syncSeedMediaPath,
  toCanonicalSeedImagePath,
  verifySeededMediaReferences,
} from "../utils/seed-media";

// ─── Constants ───────────────────────────────────────────────────────────────

const PERF_CLIENT_COUNT = 150;
const PERF_PAST_DAYS = 30;
const PERF_FUTURE_DAYS = 120;
const PERF_RANDOM_SEED = 20260419;
const PERF_SESSION_CAPACITY = 15;

const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

type CatalogStripePriceEnvSpec = { productName: string; lookupKey: string; envVarName: string };

const PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS: CatalogStripePriceEnvSpec[] = [
  { productName: "Collective Class Drop-In", lookupKey: "collective-drop-in-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_DROP_IN" },
  { productName: "5-Ticket Collective Classes", lookupKey: "qa-collective-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_5_PACK" },
  { productName: "10-Ticket Collective Classes", lookupKey: "collective-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_10_PACK" },
  { productName: "Monthly Recurrent Collective Subscription", lookupKey: "monthly-unlimited-collective-eur-monthly-v1", envVarName: "STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE" },
  { productName: "5-Ticket Private Classes", lookupKey: "qa-private-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_5_PACK" },
  { productName: "10-Ticket Private Classes", lookupKey: "qa-private-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_10_PACK" },
];

const seedDayUtc = new Date();
seedDayUtc.setUTCHours(0, 0, 0, 0);

const pastWindowStartUtc = new Date(seedDayUtc);
pastWindowStartUtc.setUTCDate(pastWindowStartUtc.getUTCDate() - PERF_PAST_DAYS);
pastWindowStartUtc.setUTCHours(0, 0, 0, 0);

const pastWindowEndUtc = new Date(seedDayUtc);
pastWindowEndUtc.setUTCDate(pastWindowEndUtc.getUTCDate() - 1);
pastWindowEndUtc.setUTCHours(23, 59, 59, 999);

const futureWindowStartUtc = new Date(seedDayUtc);
futureWindowStartUtc.setUTCDate(futureWindowStartUtc.getUTCDate() + 1);
futureWindowStartUtc.setUTCHours(0, 0, 0, 0);

const futureWindowEndUtc = new Date(seedDayUtc);
futureWindowEndUtc.setUTCDate(futureWindowEndUtc.getUTCDate() + PERF_FUTURE_DAYS);
futureWindowEndUtc.setUTCHours(23, 59, 59, 999);

const SEEDED_TEACHER_IMAGES = {
  ana: toCanonicalSeedImagePath("/images/instructors/ana_instructor_bio.jpg"),
  elena: toCanonicalSeedImagePath("/images/instructors/elena_instructor_bio.jpg"),
  sofia: toCanonicalSeedImagePath("/images/instructors/sofia_instructor_bio.jpg"),
} as const;

const SEEDED_CLASS_IMAGES = {
  vinyasaYoga: toCanonicalSeedImagePath("/images/classes/vinyasa-yoga.jpg"),
  rocketYoga: toCanonicalSeedImagePath("/images/classes/rocket-yoga.jpg"),
  hathaYoga: toCanonicalSeedImagePath("/images/classes/hatha-yoga.jpg"),
  matPilates: toCanonicalSeedImagePath("/images/classes/mat-pilates.jpg"),
  reformerFoundations: toCanonicalSeedImagePath("/images/classes/reformer-foundations.jpg"),
  functionalStrength: toCanonicalSeedImagePath("/images/classes/functional-strength.jpg"),
  privateReformerCoaching: toCanonicalSeedImagePath("/images/classes/private-reformer-coaching.jpg"),
} as const;

// ─── Utilities ───────────────────────────────────────────────────────────────

function addDaysUtc(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}


// ─── Stripe price resolution ──────────────────────────────────────────────────

function resolveRequiredCatalogStripePriceIds(): Record<string, string> {
  const stripePriceIdByLookupKey: Record<string, string> = {};
  const missing: CatalogStripePriceEnvSpec[] = [];
  const invalid: Array<CatalogStripePriceEnvSpec & { value: string }> = [];

  for (const spec of PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS) {
    const value = process.env[spec.envVarName]?.trim();
    if (!value) { missing.push(spec); continue; }
    if (!STRIPE_PRICE_ID_PATTERN.test(value)) { invalid.push({ ...spec, value }); continue; }
    stripePriceIdByLookupKey[spec.lookupKey] = value;
  }

  if (missing.length > 0 || invalid.length > 0) {
    const details = [
      missing.length > 0 ? `Missing Stripe price env vars:\n${missing.map((e) => `- ${e.envVarName} (${e.productName}, ${e.lookupKey})`).join("\n")}` : null,
      invalid.length > 0 ? `Invalid Stripe price env var values:\n${invalid.map((e) => `- ${e.envVarName}=${e.value}`).join("\n")}` : null,
    ].filter(Boolean).join("\n\n");
    throw new Error(`Perf seed validation failed for Stripe price configuration.\n${details}`);
  }

  console.info("[seed:perf] Stripe price configuration validated.");
  return stripePriceIdByLookupKey;
}

// ─── Purge ────────────────────────────────────────────────────────────────────

async function purgeForCleanSeed() {
  await prisma.marketingCampaignLinkClick.deleteMany();
  await prisma.marketingCampaignLink.deleteMany();
  await prisma.marketingCampaignRecipient.deleteMany();
  await prisma.marketingCampaign.deleteMany();
  await prisma.marketingCategory.deleteMany();
  await prisma.marketingUnsubscribe.deleteMany();

  await prisma.attendanceRecord.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.studioSession.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.classType.deleteMany();
  await prisma.classCategory.deleteMany();
  await prisma.siteWeeklyScheduleEntry.deleteMany();

  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.giftCardLedgerEntry.deleteMany();
  await prisma.giftCardReconciliationCase.deleteMany();
  await prisma.giftCardRedemption.deleteMany();
  await prisma.giftCardCode.deleteMany();
  await prisma.giftCardWallet.deleteMany();
  await prisma.cartCheckoutIdempotency.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.clientEntitlement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.adminNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contactMessage.deleteMany();
  await prisma.clientMessage.deleteMany();
  await prisma.contactMessageRateLimit.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionContract.deleteMany();
  await prisma.publicDocument.deleteMany();

  await prisma.entitlementRule.deleteMany();
  await prisma.price.deleteMany();
  await prisma.product.deleteMany();
  await prisma.mediaAsset.deleteMany();

  await prisma.bookingPolicy.deleteMany();

  await prisma.learningCourse.deleteMany();
  await prisma.learningProgram.deleteMany();

  await prisma.clientProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.publicAuthRateLimit.deleteMany();
  await prisma.pendingUserRegistration.deleteMany();
  await prisma.user.deleteMany();

  console.info("[seed:perf] Database purged.");
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function seedUsers() {
  const rng = createSeededRng(PERF_RANDOM_SEED + 11);
  const sharedPasswordHash = await hash("qwerty123456", 12);
  const sharedEmailVerifiedAt = new Date("2026-01-01T00:00:00.000Z");

  const masterAdmin = await prisma.user.create({
    data: {
      name: "Perf Master Admin", firstName: "Perf", lastName: "MasterAdmin",
      email: "masteradmin@bookmyclass-perf.local",
      role: Role.MASTER_ADMIN, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-20T08:00:00.000Z"),
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: "Perf Admin", firstName: "Perf", lastName: "Admin",
      email: "admin@bookmyclass-perf.local",
      role: Role.ADMIN, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-19T11:00:00.000Z"),
    },
  });

  const ana = await prisma.user.create({
    data: {
      name: "Ana Ionescu", firstName: "Ana", lastName: "Ionescu",
      email: "ana.ionescu@bookmyclass-perf.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: SEEDED_TEACHER_IMAGES.ana,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-18T09:30:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000001",
          bio: "Ana leads classes with a clear and progressive approach to technique, breath, and confidence in movement.",
          specialties: ["Yoga", "Pilates"], certifications: ["RYT-200"],
          hireDate: new Date("2023-09-01T00:00:00.000Z"),
        },
      },
    },
  });

  const elena = await prisma.user.create({
    data: {
      name: "Elena Moreau", firstName: "Elena", lastName: "Moreau",
      email: "elena.moreau@bookmyclass-perf.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: SEEDED_TEACHER_IMAGES.elena,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-17T10:00:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000003",
          bio: "Elena brings a calm, precise teaching style focused on alignment, strength, and confidence in movement.",
          specialties: ["Pilates", "Mobility"], certifications: ["Comprehensive Pilates"],
          hireDate: new Date("2024-02-15T00:00:00.000Z"),
        },
      },
    },
  });

  const sofia = await prisma.user.create({
    data: {
      name: "Sofia Van den Berg", firstName: "Sofia", lastName: "Van den Berg",
      email: "sofia.vandenberg@bookmyclass-perf.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: SEEDED_TEACHER_IMAGES.sofia,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-16T08:45:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000004",
          bio: "Sofia teaches flowing classes with a warm and supportive approach.",
          specialties: ["Yoga", "Stretch"], certifications: ["RYT-500"],
          hireDate: new Date("2024-05-01T00:00:00.000Z"),
        },
      },
    },
  });

  const perfClients: Array<{ id: string; email: string; name: string }> = [];
  for (let index = 0; index < PERF_CLIENT_COUNT; index += 1) {
    const clientNumber = String(index + 1).padStart(3, "0");
    const email = `perf-client-${clientNumber}@bookmyclass-perf.local`;
    const name = `Perf Client ${clientNumber}`;
    const verifiedAt = new Date(sharedEmailVerifiedAt);
    verifiedAt.setUTCDate(verifiedAt.getUTCDate() + (index % 30));
    const lastLoginAt = addDaysUtc(seedDayUtc, -rng.int(0, 45));
    lastLoginAt.setUTCHours(rng.int(7, 21), rng.int(0, 59), 0, 0);

    const created = await prisma.user.create({
      data: {
        name, firstName: "Perf", lastName: `Client ${clientNumber}`, email,
        role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false, lastLoginAt,
        clientProfile: { create: { phone: `+3202${clientNumber.padStart(8, "0")}`, notes: "Perf test client — do not use in production." } },
      },
    });
    perfClients.push({ id: created.id, email, name });
  }

  console.info(`[seed:perf] Users seeded: 1 master-admin, 1 admin, 3 teachers, ${PERF_CLIENT_COUNT} perf clients.`);
  return { masterAdmin, admin, teachers: { ana, elena, sofia }, clients: perfClients };
}

// ─── Booking policy ───────────────────────────────────────────────────────────

async function seedBookingPolicy() {
  await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    update: { cancellationCutoffHours: 24 },
    create: { scope: "GLOBAL", cancellationCutoffHours: 24 },
  });
}

// ─── Catalog helpers ──────────────────────────────────────────────────────────

async function upsertProduct(input: { slug: string; name: string; description: string; productType: ProductType; sortOrder: number }) {
  return prisma.product.upsert({
    where: { slug: input.slug },
    update: { name: input.name, description: input.description, productType: input.productType, isActive: true, isArchived: false, sortOrder: input.sortOrder },
    create: { slug: input.slug, name: input.name, description: input.description, productType: input.productType, isActive: true, isArchived: false, sortOrder: input.sortOrder },
  });
}

async function upsertPrice(input: { productId: string; lookupKey: string; stripePriceId?: string; name: string; priceType: PriceType; currencyCode: string; unitAmountMinor: number; billingInterval?: BillingInterval; billingIntervalCount?: number }) {
  const hasStripePriceId = Boolean(input.stripePriceId?.trim());
  const stripeSyncStatus = hasStripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING;
  const stripeSyncLastAttempt = hasStripePriceId ? new Date() : null;
  const stripeSyncLastSuccess = hasStripePriceId ? new Date() : null;
  return prisma.price.upsert({
    where: { lookupKey: input.lookupKey },
    update: { productId: input.productId, name: input.name, stripePriceId: input.stripePriceId, stripeSyncStatus, stripeSyncLastAttempt, stripeSyncLastSuccess, stripeSyncErrorCode: null, stripeSyncError: null, stripeSyncCorrelation: null, priceType: input.priceType, currencyCode: input.currencyCode, unitAmountMinor: input.unitAmountMinor, billingInterval: input.billingInterval, billingIntervalCount: input.billingIntervalCount, isActive: true, isArchived: false, startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: null },
    create: { productId: input.productId, lookupKey: input.lookupKey, stripePriceId: input.stripePriceId, stripeSyncStatus, stripeSyncLastAttempt, stripeSyncLastSuccess, stripeSyncErrorCode: null, stripeSyncError: null, stripeSyncCorrelation: null, name: input.name, priceType: input.priceType, currencyCode: input.currencyCode, unitAmountMinor: input.unitAmountMinor, billingInterval: input.billingInterval, billingIntervalCount: input.billingIntervalCount, isActive: true, isArchived: false, startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: null },
  });
}

async function upsertEntitlementRule(input: { productId: string; entitlementType: EntitlementType; entitlementScope: EntitlementScope; quantity?: number; validForDays?: number; notes?: string }) {
  return prisma.entitlementRule.upsert({
    where: { productId_entitlementType_entitlementScope: { productId: input.productId, entitlementType: input.entitlementType, entitlementScope: input.entitlementScope } },
    update: { quantity: input.quantity, validForDays: input.validForDays, notes: input.notes, isActive: true },
    create: { productId: input.productId, entitlementType: input.entitlementType, entitlementScope: input.entitlementScope, quantity: input.quantity, validForDays: input.validForDays, notes: input.notes, isActive: true },
  });
}

async function seedCatalog(stripePriceIdByLookupKey: Record<string, string>) {
  const collectiveDropIn = await upsertProduct({ slug: "collective-drop-in", name: "Collective Class Drop-In", description: "Single booking access for collective yoga, pilates and functional classes.", productType: ProductType.DROP_IN_CLASS, sortOrder: 10 });
  await upsertPrice({ productId: collectiveDropIn.id, lookupKey: "collective-drop-in-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-drop-in-eur-once-v1"], name: "Collective Drop-In - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 2200 });
  await upsertEntitlementRule({ productId: collectiveDropIn.id, entitlementType: EntitlementType.SINGLE_USE, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 1, validForDays: 30, notes: "Single collective class booking entitlement." });

  const collectiveFivePack = await upsertProduct({ slug: "collective-5-class-pack", name: "5-Ticket Collective Classes", description: "Five class credits for collective classes.", productType: ProductType.CLASS_PACK, sortOrder: 20 });
  await upsertPrice({ productId: collectiveFivePack.id, lookupKey: "qa-collective-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-collective-5-pack-eur-once-v1"], name: "5-Class Pack - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 9500 });
  await upsertEntitlementRule({ productId: collectiveFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 5, validForDays: 90, notes: "Five credits for collective class bookings." });

  const collectiveTenPack = await upsertProduct({ slug: "collective-10-class-pack", name: "10-Ticket Collective Classes", description: "Ten class credits for collective classes.", productType: ProductType.CLASS_PACK, sortOrder: 30 });
  await upsertPrice({ productId: collectiveTenPack.id, lookupKey: "collective-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-10-pack-eur-once-v1"], name: "10-Class Pack - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 17900 });
  await upsertEntitlementRule({ productId: collectiveTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 10, validForDays: 120, notes: "Ten credits for collective class bookings." });

  const collectiveMonthly = await upsertProduct({ slug: "monthly-unlimited-collective", name: "Monthly Recurrent Collective Subscription", description: "Recurring monthly subscription for collective classes.", productType: ProductType.UNLIMITED_MEMBERSHIP, sortOrder: 40 });
  await upsertPrice({ productId: collectiveMonthly.id, lookupKey: "monthly-unlimited-collective-eur-monthly-v1", stripePriceId: stripePriceIdByLookupKey["monthly-unlimited-collective-eur-monthly-v1"], name: "Monthly Unlimited Collective - Monthly", priceType: PriceType.RECURRING, currencyCode: "EUR", unitAmountMinor: 12900, billingInterval: BillingInterval.MONTH, billingIntervalCount: 1 });
  await upsertEntitlementRule({ productId: collectiveMonthly.id, entitlementType: EntitlementType.UNLIMITED_ACCESS, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, validForDays: 30, notes: "Unlimited access entitlement for active subscription period." });

  const privateFivePack = await upsertProduct({ slug: "private-5-class-pack", name: "5-Ticket Private Classes", description: "Five private class credits.", productType: ProductType.PRIVATE_PACK, sortOrder: 50 });
  await upsertPrice({ productId: privateFivePack.id, lookupKey: "qa-private-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-5-pack-eur-once-v1"], name: "5-Private Sessions - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 32000 });
  await upsertEntitlementRule({ productId: privateFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 5, validForDays: 180, notes: "Five credits for private classes." });

  const privateTenPack = await upsertProduct({ slug: "private-10-class-pack", name: "10-Ticket Private Classes", description: "Ten private class credits.", productType: ProductType.PRIVATE_PACK, sortOrder: 60 });
  await upsertPrice({ productId: privateTenPack.id, lookupKey: "qa-private-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-10-pack-eur-once-v1"], name: "10-Private Sessions - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 60000 });
  await upsertEntitlementRule({ productId: privateTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 10, validForDays: 240, notes: "Ten credits for private classes." });

  console.info("[seed:perf] Catalog seeded (6 products).");
}

// ─── Class schedule helpers ───────────────────────────────────────────────────

async function upsertClassCategory(input: { slug: string; name: string; description: string; sortOrder: number }) {
  return prisma.classCategory.upsert({
    where: { slug: input.slug },
    update: { name: input.name, description: input.description, isActive: true, sortOrder: input.sortOrder },
    create: { slug: input.slug, name: input.name, description: input.description, isActive: true, sortOrder: input.sortOrder },
  });
}

async function upsertClassType(input: { slug: string; categoryId: string; name: string; description: string; imageUrl?: string; defaultDurationMinutes: number; defaultCapacity: number; pricingMode: ServicePricingMode; serviceScope: EntitlementScope; sortOrder: number }) {
  return prisma.classType.upsert({
    where: { slug: input.slug },
    update: { categoryId: input.categoryId, name: input.name, description: input.description, imageUrl: input.imageUrl, defaultDurationMinutes: input.defaultDurationMinutes, defaultCapacity: input.defaultCapacity, pricingMode: input.pricingMode, serviceScope: input.serviceScope, isActive: true, isVisible: true, sortOrder: input.sortOrder },
    create: { slug: input.slug, categoryId: input.categoryId, name: input.name, description: input.description, imageUrl: input.imageUrl, defaultDurationMinutes: input.defaultDurationMinutes, defaultCapacity: input.defaultCapacity, pricingMode: input.pricingMode, serviceScope: input.serviceScope, isActive: true, isVisible: true, sortOrder: input.sortOrder },
  });
}

async function upsertClassTemplate(input: { slug: string; classTypeId: string; defaultTeacherId: string; title: string; description: string; location: string; defaultCapacity: number; defaultDurationMinutes: number }) {
  return prisma.classTemplate.upsert({
    where: { slug: input.slug },
    update: { classTypeId: input.classTypeId, defaultTeacherId: input.defaultTeacherId, title: input.title, description: input.description, location: input.location, defaultCapacity: input.defaultCapacity, defaultDurationMinutes: input.defaultDurationMinutes, isActive: true, isPublished: true },
    create: { slug: input.slug, classTypeId: input.classTypeId, defaultTeacherId: input.defaultTeacherId, title: input.title, description: input.description, location: input.location, defaultCapacity: input.defaultCapacity, defaultDurationMinutes: input.defaultDurationMinutes, isActive: true, isPublished: true },
  });
}

async function upsertStudioSession(input: { classTemplateId: string; classTypeId: string; teacherId: string; title: string; description?: string; location?: string; startsAt: Date; endsAt: Date; capacity: number }) {
  return prisma.studioSession.upsert({
    where: { classTemplateId_startsAt: { classTemplateId: input.classTemplateId, startsAt: input.startsAt } },
    update: { classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, cancelledAt: null, cancelledReason: null, cancelledById: null, isPublished: true },
    create: { classTemplateId: input.classTemplateId, classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, startsAt: input.startsAt, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, isPublished: true },
  });
}

// ─── Agenda schedule ──────────────────────────────────────────────────────────

async function seedAgendaSchedule() {
  for (let index = 0; index < AGENDA_SCHEDULE.length; index += 1) {
    const entry = AGENDA_SCHEDULE[index]!;
    await prisma.siteWeeklyScheduleEntry.upsert({
      where: { id: `seed-schedule-${entry.dayOfWeek}-${index}` },
      update: { dayOfWeek: entry.dayOfWeek, startTime: entry.startTime, endTime: entry.endTime, label: entry.label, displayOrder: entry.displayOrder, isActive: true },
      create: { id: `seed-schedule-${entry.dayOfWeek}-${index}`, dayOfWeek: entry.dayOfWeek, startTime: entry.startTime, endTime: entry.endTime, label: entry.label, displayOrder: entry.displayOrder, isActive: true },
    });
  }
  console.info(`[seed:perf] Agenda schedule seeded: ${AGENDA_SCHEDULE.length} entries.`);
}

// ─── Scheduling + entitlements + bookings ─────────────────────────────────────

async function seedSchedulingAndBookings(input: {
  teachers: { anaId: string; elenaId: string; sofiaId: string };
  clients: Array<{ id: string; email: string; name: string }>;
}) {
  const rng = createSeededRng(PERF_RANDOM_SEED + 97);
  const { teachers, clients } = input;

  const yogaCategory = await upsertClassCategory({ slug: "yoga-collective-classes", name: "Yoga Collective Classes", description: "Dynamic and restorative yoga classes for collective groups.", sortOrder: 10 });
  const pilatesCategory = await upsertClassCategory({ slug: "pilates-collective-classes", name: "Pilates Collective Classes", description: "Mat and reformer-inspired pilates sessions in small groups.", sortOrder: 20 });
  const fitnessCategory = await upsertClassCategory({ slug: "fitness-functional", name: "Fitness & Functional", description: "Strength, mobility, and conditioning sessions.", sortOrder: 30 });
  const privateCategory = await upsertClassCategory({ slug: "private-reformer-coach", name: "Private Reformer Coach", description: "Private reformer coaching and technique refinement.", sortOrder: 40 });

  const vinyasaYoga = await upsertClassType({ slug: "vinyasa-yoga", categoryId: yogaCategory.id, name: "Vinyasa Yoga", description: "Breath-led flowing yoga for strength and mobility.", imageUrl: SEEDED_CLASS_IMAGES.vinyasaYoga, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const rocketYoga = await upsertClassType({ slug: "rocket-yoga", categoryId: yogaCategory.id, name: "Rocket Yoga", description: "High-energy yoga sequencing with progressive options.", imageUrl: SEEDED_CLASS_IMAGES.rocketYoga, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const hathaYoga = await upsertClassType({ slug: "hatha-yoga", categoryId: yogaCategory.id, name: "Hatha Yoga", description: "Slower paced foundational yoga and alignment practice.", imageUrl: SEEDED_CLASS_IMAGES.hathaYoga, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 30 });
  const matPilates = await upsertClassType({ slug: "mat-pilates", categoryId: pilatesCategory.id, name: "Mat Pilates", description: "Core-driven pilates session suitable for all levels.", imageUrl: SEEDED_CLASS_IMAGES.matPilates, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const reformerFoundations = await upsertClassType({ slug: "reformer-foundations", categoryId: pilatesCategory.id, name: "Reformer Foundations", description: "Small group reformer fundamentals for technique and control.", imageUrl: SEEDED_CLASS_IMAGES.reformerFoundations, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const functionalStrength = await upsertClassType({ slug: "functional-strength", categoryId: fitnessCategory.id, name: "Functional Strength", description: "Strength and conditioning with athletic movement patterns.", imageUrl: SEEDED_CLASS_IMAGES.functionalStrength, defaultDurationMinutes: 30, defaultCapacity: PERF_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const privateReformerCoaching = await upsertClassType({ slug: "private-reformer-coaching", categoryId: privateCategory.id, name: "Private Reformer Coaching", description: "Private 1:1 or duo coaching on the reformer.", imageUrl: SEEDED_CLASS_IMAGES.privateReformerCoaching, defaultDurationMinutes: 30, defaultCapacity: 1, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.PRIVATE_CLASSES, sortOrder: 10 });

  const vinyasaTemplate = await upsertClassTemplate({ slug: "vinyasa-flow-brussels", classTypeId: vinyasaYoga.id, defaultTeacherId: teachers.anaId, title: "Vinyasa Flow Brussels", description: "A full-spectrum vinyasa class with warm-up, flow and cooldown.", location: "Ixelles Studio A", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const rocketTemplate = await upsertClassTemplate({ slug: "rocket-yoga-power-sequence", classTypeId: rocketYoga.id, defaultTeacherId: teachers.sofiaId, title: "Rocket Yoga Power Sequence", description: "Progressive rocket yoga with core and inversion prep.", location: "Ixelles Studio B", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const hathaTemplate = await upsertClassTemplate({ slug: "hatha-reset-weekend", classTypeId: hathaYoga.id, defaultTeacherId: teachers.anaId, title: "Hatha Reset Weekend", description: "Grounding hatha class focused on breath and posture quality.", location: "Ixelles Studio A", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const matPilatesTemplate = await upsertClassTemplate({ slug: "mat-pilates-core-lab", classTypeId: matPilates.id, defaultTeacherId: teachers.elenaId, title: "Mat Pilates Core Lab", description: "Core and glute-focused mat pilates with progression options.", location: "Etterbeek Studio C", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const reformerTemplate = await upsertClassTemplate({ slug: "reformer-foundations-small-group", classTypeId: reformerFoundations.id, defaultTeacherId: teachers.elenaId, title: "Reformer Foundations Small Group", description: "Technique-first reformer foundations for beginners.", location: "Ixelles Reformer Room", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const functionalTemplate = await upsertClassTemplate({ slug: "functional-strength-express", classTypeId: functionalStrength.id, defaultTeacherId: teachers.sofiaId, title: "Functional Strength Express", description: "High-focus functional strength class with mobility warm-up.", location: "Etterbeek Performance Room", defaultCapacity: PERF_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  await upsertClassTemplate({ slug: "private-reformer-coaching-slot", classTypeId: privateReformerCoaching.id, defaultTeacherId: teachers.anaId, title: "Private Reformer Coaching", description: "Private coaching slot tailored to goals and mobility.", location: "Ixelles Private Studio", defaultCapacity: 1, defaultDurationMinutes: 30 });

  const collectiveRotation = [
    { template: vinyasaTemplate, classTypeId: vinyasaYoga.id, teacherId: teachers.anaId },
    { template: rocketTemplate, classTypeId: rocketYoga.id, teacherId: teachers.sofiaId },
    { template: hathaTemplate, classTypeId: hathaYoga.id, teacherId: teachers.anaId },
    { template: matPilatesTemplate, classTypeId: matPilates.id, teacherId: teachers.elenaId },
    { template: reformerTemplate, classTypeId: reformerFoundations.id, teacherId: teachers.elenaId },
    { template: functionalTemplate, classTypeId: functionalStrength.id, teacherId: teachers.sofiaId },
  ] as const;

  // Past sessions: 3 per week for PERF_PAST_DAYS
  type PerfSessionSeed = { id: string; startsAt: Date; capacity: number; classTypeId: string; isFuture: boolean; occupancyTarget: number };
  const allSessions: PerfSessionSeed[] = [];

  const pastWeekOffsets = [1, 3, 5] as const;
  const pastSessionTimePool = [{ hour: 7, minute: 0 }, { hour: 12, minute: 0 }, { hour: 18, minute: 0 }] as const;
  const weekCursor = startOfUtcDay(pastWindowStartUtc);
  const dayOfWeek = weekCursor.getUTCDay();
  weekCursor.setUTCDate(weekCursor.getUTCDate() + (dayOfWeek === 0 ? -6 : 1 - dayOfWeek));

  let pastWeekIndex = 0;
  while (weekCursor <= pastWindowEndUtc) {
    for (let slotInWeek = 0; slotInWeek < 3; slotInWeek += 1) {
      const startsAt = addDaysUtc(weekCursor, pastWeekOffsets[slotInWeek]!);
      const sessionTime = pastSessionTimePool[(pastWeekIndex * 3 + slotInWeek) % pastSessionTimePool.length]!;
      startsAt.setUTCHours(sessionTime.hour, sessionTime.minute, 0, 0);
      if (startsAt < pastWindowStartUtc || startsAt > pastWindowEndUtc) continue;
      const def = collectiveRotation[(pastWeekIndex * 3 + slotInWeek) % collectiveRotation.length]!;
      const session = await upsertStudioSession({ classTemplateId: def.template.id, classTypeId: def.classTypeId, teacherId: def.teacherId, title: def.template.title, description: def.template.description ?? undefined, location: def.template.location ?? undefined, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000), capacity: PERF_SESSION_CAPACITY });
      await prisma.studioSession.update({ where: { id: session.id }, data: { status: StudioSessionStatus.COMPLETED } });
      allSessions.push({ id: session.id, startsAt, capacity: PERF_SESSION_CAPACITY, classTypeId: def.classTypeId, isFuture: false, occupancyTarget: rng.int(4, 12) });
    }
    weekCursor.setUTCDate(weekCursor.getUTCDate() + 7);
    pastWeekIndex += 1;
  }

  // Future sessions: 3 per week for PERF_FUTURE_DAYS — dense but realistic
  const futureWeekOffsets = [1, 3, 5] as const;
  const futureSessionTimePool = [{ hour: 8, minute: 0 }, { hour: 12, minute: 0 }, { hour: 18, minute: 30 }] as const;
  const futureCursor = startOfUtcDay(futureWindowStartUtc);
  const futureDow = futureCursor.getUTCDay();
  futureCursor.setUTCDate(futureCursor.getUTCDate() + (futureDow === 0 ? -6 : 1 - futureDow));
  let futureWeekIndex = 0;
  while (futureCursor <= futureWindowEndUtc) {
    for (let slotInWeek = 0; slotInWeek < 3; slotInWeek += 1) {
      const startsAt = addDaysUtc(futureCursor, futureWeekOffsets[slotInWeek]!);
      const sessionTime = futureSessionTimePool[(futureWeekIndex * 3 + slotInWeek) % futureSessionTimePool.length]!;
      startsAt.setUTCHours(sessionTime.hour, sessionTime.minute, 0, 0);
      if (startsAt < futureWindowStartUtc || startsAt > futureWindowEndUtc) continue;
      const def = collectiveRotation[(futureWeekIndex * 3 + slotInWeek) % collectiveRotation.length]!;
      const session = await upsertStudioSession({ classTemplateId: def.template.id, classTypeId: def.classTypeId, teacherId: def.teacherId, title: def.template.title, description: def.template.description ?? undefined, location: def.template.location ?? undefined, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000), capacity: PERF_SESSION_CAPACITY });
      // Target ~50% occupancy in future sessions for realistic load testing
      allSessions.push({ id: session.id, startsAt, capacity: PERF_SESSION_CAPACITY, classTypeId: def.classTypeId, isFuture: true, occupancyTarget: rng.int(3, 9) });
    }
    futureCursor.setUTCDate(futureCursor.getUTCDate() + 7);
    futureWeekIndex += 1;
  }

  console.info(`[seed:perf] Sessions generated: ${allSessions.filter((s) => !s.isFuture).length} past, ${allSessions.filter((s) => s.isFuture).length} future.`);

  // All clients get a 10-pack entitlement (active for 150 days from now) — perf testing needs them all bookable
  const catalogPrices = await prisma.price.findMany({
    where: { lookupKey: "collective-10-pack-eur-once-v1", isActive: true, isArchived: false },
    include: { product: true },
  });
  const tenPackPrice = catalogPrices[0];
  if (!tenPackPrice) throw new Error("[seed:perf] 10-pack price not found — catalog seed must run first.");
  const entitlementRule = await prisma.entitlementRule.findFirst({ where: { productId: tenPackPrice.productId, isActive: true, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES } });
  if (!entitlementRule) throw new Error("[seed:perf] Collective entitlement rule not found.");

  type PerfEntitlementState = { id: string; orderId: string; priceId: string; creditsRemaining: number; activatedAt: Date; expiresAt: Date | null };
  const entitlementsByClientId = new Map<string, PerfEntitlementState>();
  const purchasedAt = addDaysUtc(seedDayUtc, -10);
  const expiresAt = addDaysUtc(seedDayUtc, 150);

  for (const client of clients) {
    const order = await prisma.order.create({
      data: { clientId: client.id, subtotalAmountMinor: tenPackPrice.unitAmountMinor, discountAmountMinor: 0, totalAmountMinor: tenPackPrice.unitAmountMinor, currencyCode: tenPackPrice.currencyCode, status: OrderStatus.PAID, placedAt: purchasedAt, notes: "seed-perf-collective-10-pack" },
    });
    await prisma.orderItem.create({ data: { orderId: order.id, productId: tenPackPrice.productId, priceId: tenPackPrice.id, quantity: 1, productNameSnapshot: tenPackPrice.product.name, priceNameSnapshot: tenPackPrice.name, unitAmountMinor: tenPackPrice.unitAmountMinor, lineSubtotalAmountMinor: tenPackPrice.unitAmountMinor, lineDiscountAmountMinor: 0, lineTotalAmountMinor: tenPackPrice.unitAmountMinor, currencyCode: tenPackPrice.currencyCode } });
    await prisma.payment.create({ data: { orderId: order.id, status: PaymentStatus.SUCCEEDED, method: PaymentMethod.CARD, provider: PaymentProvider.STRIPE, providerReference: `seed-perf-payment-${order.id}`, stripeCheckoutSessionId: `cs_test_seed_perf_${order.id.slice(0, 16)}`, stripeCustomerId: `cus_perf_${client.id.slice(0, 12)}`, stripeCheckoutMode: StripeCheckoutMode.PAYMENT, amountMinor: tenPackPrice.unitAmountMinor, currencyCode: tenPackPrice.currencyCode, authorizedAt: purchasedAt, capturedAt: purchasedAt, createdAt: purchasedAt } });
    const entitlement = await prisma.clientEntitlement.create({ data: { clientId: client.id, productId: tenPackPrice.productId, orderId: order.id, subscriptionContractId: null, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, status: ClientEntitlementStatus.ACTIVE, activatedAt: purchasedAt, expiresAt } });
    await prisma.creditLedgerEntry.create({ data: { clientId: client.id, entryType: CreditLedgerEntryType.GRANT, amount: 10, happenedAt: purchasedAt, entitlementId: entitlement.id, orderId: order.id, notes: "Perf seed 10-pack grant" } });
    entitlementsByClientId.set(client.id, { id: entitlement.id, orderId: order.id, priceId: tenPackPrice.id, creditsRemaining: 10, activatedAt: purchasedAt, expiresAt });
  }

  console.info(`[seed:perf] Entitlements created: ${clients.length} clients each with a 10-pack.`);

  // Create bookings up to occupancyTarget per session, rotating through clients
  const bookedPairs = new Set<string>();
  let createdBookingsCount = 0;
  let clientIndex = 0;

  allSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  for (const session of allSessions) {
    let createdForSession = 0;
    let guard = 0;
    while (createdForSession < session.occupancyTarget && guard < PERF_CLIENT_COUNT * 2) {
      guard += 1;
      const client = clients[clientIndex % clients.length]!;
      clientIndex += 1;
      const pairKey = `${client.id}::${session.id}`;
      if (bookedPairs.has(pairKey)) continue;
      const entitlement = entitlementsByClientId.get(client.id);
      if (!entitlement || entitlement.creditsRemaining <= 0) continue;
      if (session.startsAt < entitlement.activatedAt) continue;
      if (entitlement.expiresAt && session.startsAt > entitlement.expiresAt) continue;

      const bookedAt = addDaysUtc(session.startsAt, -rng.int(1, 7));
      const cancellationEligibleUntilAt = new Date(session.startsAt.getTime() - 24 * 60 * 60 * 1000);
      let status: BookingStatus = session.isFuture ? BookingStatus.CONFIRMED : BookingStatus.COMPLETED;
      let cancelledAt: Date | undefined;
      if (!session.isFuture && rng.next() < 0.07) { status = BookingStatus.CANCELLED; cancelledAt = addDaysUtc(session.startsAt, -2); }

      const booking = await prisma.booking.create({
        data: { clientId: client.id, studioSessionId: session.id, orderId: entitlement.orderId, status, bookingIntent: BookingIntent.USE_PLAN, paymentSelection: BookingPaymentSelection.EXISTING_PLAN, selectedEntitlementId: entitlement.id, selectedPriceId: entitlement.priceId, bookedAt, customerName: client.name, customerEmail: client.email, consentTermsAccepted: true, consentPrivacyAccepted: true, consentAcceptedAt: bookedAt, cancellationEligibleUntilAt, cancelledAt: cancelledAt ?? null, creditRefundedAt: status === BookingStatus.CANCELLED ? cancelledAt ?? bookedAt : null },
      });
      bookedPairs.add(pairKey);
      entitlement.creditsRemaining -= 1;

      await prisma.creditLedgerEntry.create({ data: { clientId: client.id, entryType: CreditLedgerEntryType.CONSUME, amount: -1, happenedAt: bookedAt, entitlementId: entitlement.id, bookingId: booking.id, orderId: entitlement.orderId, notes: "Perf seed booking credit consumption" } });
      if (status === BookingStatus.CANCELLED) {
        entitlement.creditsRemaining += 1;
        await prisma.creditLedgerEntry.create({ data: { clientId: client.id, entryType: CreditLedgerEntryType.RESTORE, amount: 1, happenedAt: cancelledAt ?? bookedAt, entitlementId: entitlement.id, bookingId: booking.id, orderId: entitlement.orderId, notes: "Perf seed cancellation credit restore" } });
      }

      createdForSession += 1;
      createdBookingsCount += 1;
    }
  }

  const pastSessionCount = allSessions.filter((s) => !s.isFuture).length;
  const futureSessionCount = allSessions.filter((s) => s.isFuture).length;
  console.info(`[seed:perf] Bookings created: ${createdBookingsCount} across ${pastSessionCount} past + ${futureSessionCount} future sessions.`);
  return { pastSessionCount, futureSessionCount, bookingCount: createdBookingsCount };
}

// ─── Verification ─────────────────────────────────────────────────────────────

async function verifyPerfSeed(summary: { pastSessionCount: number; futureSessionCount: number; bookingCount: number }) {
  const [totalClients, totalAdmins, totalTeachers, totalProducts, scheduleCount] = await prisma.$transaction([
    prisma.user.count({ where: { role: Role.CLIENT } }),
    prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] } } }),
    prisma.user.count({ where: { role: Role.TEACHER } }),
    prisma.product.count({ where: { isActive: true, isArchived: false } }),
    prisma.siteWeeklyScheduleEntry.count({ where: { isActive: true } }),
  ]);

  if (totalClients !== PERF_CLIENT_COUNT) throw new Error(`Perf seed verification: expected ${PERF_CLIENT_COUNT} clients, got ${totalClients}.`);
  if (totalAdmins !== 2) throw new Error(`Perf seed verification: expected 2 admins, got ${totalAdmins}.`);
  if (totalTeachers !== 3) throw new Error(`Perf seed verification: expected 3 teachers, got ${totalTeachers}.`);
  if (totalProducts !== 6) throw new Error(`Perf seed verification: expected 6 products, got ${totalProducts}.`);
  if (scheduleCount === 0) throw new Error("Perf seed verification: no agenda schedule entries found.");
  if (summary.futureSessionCount === 0) throw new Error("Perf seed verification: no future sessions generated.");

  const duplicateActiveBookings = await prisma.$queryRaw<Array<{ duplicate_count: string }>>`
    SELECT COUNT(*)::text AS duplicate_count FROM (
      SELECT "clientId", "studioSessionId", COUNT(*) AS row_count FROM "Booking"
      WHERE "clientId" IS NOT NULL AND status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
      GROUP BY "clientId", "studioSessionId" HAVING COUNT(*) > 1
    ) duplicates
  `;
  const duplicateCount = Number.parseInt(duplicateActiveBookings[0]?.duplicate_count ?? "0", 10);
  if (duplicateCount > 0) throw new Error(`Perf seed verification: found ${duplicateCount} duplicate active bookings.`);

  console.info(`[seed:perf] Verification passed. clients=${totalClients}, products=${totalProducts}, pastSessions=${summary.pastSessionCount}, futureSessions=${summary.futureSessionCount}, bookings=${summary.bookingCount}, scheduleEntries=${scheduleCount}.`);
}

async function syncSeedMediaFilesFromDatabase(): Promise<{ copiedCount: number; existingCount: number }> {
  const [users, classTypes] = await prisma.$transaction([
    prisma.user.findMany({ where: { image: { startsWith: "/uploads/" } }, select: { image: true } }),
    prisma.classType.findMany({ where: { imageUrl: { startsWith: "/uploads/" } }, select: { imageUrl: true } }),
  ]);

  const paths = new Set<string>();
  for (const row of users) if (row.image) paths.add(row.image);
  for (const row of classTypes) if (row.imageUrl) paths.add(row.imageUrl);

  let copiedCount = 0;
  let existingCount = 0;
  for (const mediaPath of paths) {
    const result = await syncSeedMediaPath(mediaPath);
    if (result === "copied") copiedCount += 1;
    else existingCount += 1;
  }
  return { copiedCount, existingCount };
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runUatPerformanceSeed(): Promise<void> {
  console.info("[seed:perf] Starting UAT performance seed (mode: uat-performance — isolated perf data).");
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  await purgeForCleanSeed();
  const { teachers, clients } = await seedUsers();
  await seedBookingPolicy();
  await seedCatalog(stripePriceIdByLookupKey);
  await seedAgendaSchedule();
  const summary = await seedSchedulingAndBookings({ teachers: { anaId: teachers.ana.id, elenaId: teachers.elena.id, sofiaId: teachers.sofia.id }, clients });
  const mediaSyncSummary = await syncSeedMediaFilesFromDatabase();
  console.info(`[seed:perf] Seed media sync: copied=${mediaSyncSummary.copiedCount}, existing=${mediaSyncSummary.existingCount}.`);
  const seededMediaPathCount = await verifySeededMediaReferences(prisma);
  console.info(`[seed:perf] Seeded media verified: ${seededMediaPathCount} canonical /uploads paths.`);
  await verifyPerfSeed(summary);
  console.info(`[seed:perf] Completed: clients=${PERF_CLIENT_COUNT}, pastSessions=${summary.pastSessionCount}, futureSessions=${summary.futureSessionCount}, bookings=${summary.bookingCount}.`);
}
