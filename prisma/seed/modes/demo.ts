/**
 * Production seed mode — safe launch seed for the production environment.
 * Upsert-only (no purge): safe to re-run at any time without data loss.
 * All deterministic seeded users use @bookmyclass.app emails.
 * Password for all seeded accounts is centralized in seed-credentials.
 *
 * Creates:
 *   - 5 staff users (master-admin, admin, 3 teachers)
 *   - 24 deterministic Studio Aster clients (@bookmyclass.app)
 *   - 6 products (same catalog slugs as dev/perf)
 *   - 6 class templates with 6 months of sessions (3 slots/week/template)
 *   - 3 learning programmes with 6 courses each
 *   - Pre-populated bookings for the next 120 days
 *   - Marketing campaign history (records only — no emails sent)
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
  MarketingAudienceType,
  MarketingCampaignStatus,
  MarketingRecipientStatus,
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
  SubscriptionStatus,
  Weekday,
} from "@prisma/client";
import { hash } from "bcryptjs";
import prisma from "../../../src/lib/db";
import { assertLearningImagePath } from "../../../src/lib/learning/image-paths";
import {
  DEMO_CLIENTS,
  DEMO_CLIENT_COUNT,
  DEMO_TEACHERS,
  DEMO_WEEKLY_SCHEDULE,
  assertDemoScheduleAgreement,
} from "../data/demo-studio";
import { STORE_CATALOG_PRODUCT_COUNT, STORE_CATALOG_PRODUCTS } from "../data/store-catalog";
import { SEEDED_USER_PASSWORD } from "../seed-credentials";
import {
  PILATES_COURSES,
  PILATES_PROGRAM,
  FITNESS_COURSES,
  FITNESS_PROGRAM,
  YOGA_COURSES,
  YOGA_PROGRAM,
} from "../data/learning-production";
import { createSeededRng } from "../utils/deterministic-random";
import {
  buildSeedMediaPlan,
  buildStoreSeedAssetFilename,
  overwriteSeedMediaAsset,
  readSeedFileSizeBytes,
  syncSeedMediaPath,
  toCanonicalSeedImagePath,
  verifySeededMediaReferences,
} from "../utils/seed-media";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROD_CLIENT_COUNT = DEMO_CLIENT_COUNT;
const PROD_FUTURE_WEEKS = 26; // ≈ 6 months of sessions
const PROD_BOOKING_DAYS = 120; // pre-populate bookings this far ahead
const PROD_RANDOM_SEED = 20260420;

const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]+$/;

type CatalogStripePriceEnvSpec = { productName: string; lookupKey: string; envVarName: string };

const PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS: CatalogStripePriceEnvSpec[] = [
  { productName: "Drop-in Class", lookupKey: "collective-drop-in-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_DROP_IN" },
  { productName: "5-Class Pack", lookupKey: "qa-collective-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_5_PACK" },
  { productName: "10-Class Pack", lookupKey: "collective-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_10_PACK" },
  { productName: "Unlimited Monthly Membership", lookupKey: "monthly-unlimited-collective-eur-monthly-v1", envVarName: "STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE" },
  { productName: "5 Private Sessions", lookupKey: "qa-private-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_5_PACK" },
  { productName: "10 Private Sessions", lookupKey: "qa-private-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_10_PACK" },
  ...STORE_CATALOG_PRODUCTS.map((product) => ({
    productName: product.name,
    lookupKey: product.price.lookupKey,
    envVarName: product.price.stripePriceEnvVarName,
  })),
];

const seedDayUtc = new Date();
seedDayUtc.setUTCHours(0, 0, 0, 0);

const bookingWindowEndUtc = new Date(seedDayUtc);
bookingWindowEndUtc.setUTCDate(bookingWindowEndUtc.getUTCDate() + PROD_BOOKING_DAYS);
bookingWindowEndUtc.setUTCHours(23, 59, 59, 999);

const sessionWindowEndUtc = new Date(seedDayUtc);
sessionWindowEndUtc.setUTCDate(sessionWindowEndUtc.getUTCDate() + PROD_FUTURE_WEEKS * 7);
sessionWindowEndUtc.setUTCHours(23, 59, 59, 999);

const SEEDED_TEACHER_IMAGES = {
  ana: "/uploads/teachers/ana_instructor_bio.jpg",
  elena: "/uploads/teachers/elena_instructor_bio.jpg",
  sofia: "/uploads/teachers/sofia_instructor_bio.jpg",
} as const;

const SEEDED_CLASS_IMAGES = {
  vinyasaYoga: "/uploads/classes/vinyasa-yoga.jpg",
  rocketYoga: "/uploads/classes/rocket-yoga.jpg",
  hathaYoga: "/uploads/classes/hatha-yoga.jpg",
  matPilates: "/uploads/classes/mat-pilates.jpg",
  reformerFoundations: "/uploads/classes/reformer-foundations.jpg",
  functionalStrength: "/uploads/classes/functional-strength.jpg",
  privateReformerCoaching: "/uploads/classes/private-reformer-coaching.jpg",
} as const;

// ─── Utilities ───────────────────────────────────────────────────────────────

function addDaysUtc(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsUtc(value: Date, months: number): Date {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function endOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function weekdayToJsDay(weekday: Weekday): number {
  switch (weekday) {
    case Weekday.MONDAY: return 1;
    case Weekday.TUESDAY: return 2;
    case Weekday.WEDNESDAY: return 3;
    case Weekday.THURSDAY: return 4;
    case Weekday.FRIDAY: return 5;
    case Weekday.SATURDAY: return 6;
    case Weekday.SUNDAY: return 0;
  }
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = time.split(":");
  return { hour: Number(hourRaw), minute: Number(minuteRaw) };
}

function nextOccurrencesInWindow(params: { weekday: Weekday; time: string; windowStart: Date; windowEnd: Date }): Date[] {
  const { weekday, time, windowStart, windowEnd } = params;
  const jsDay = weekdayToJsDay(weekday);
  const { hour, minute } = parseTime(time);
  const result: Date[] = [];
  const cursor = new Date(windowStart);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= windowEnd) {
    if (cursor.getUTCDay() === jsDay) {
      const startsAt = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), hour, minute, 0, 0));
      if (startsAt >= windowStart && startsAt <= windowEnd) result.push(startsAt);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
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
    throw new Error(`Production seed validation failed for Stripe price configuration.\n${details}`);
  }

  console.info("[seed:demo] Stripe price configuration validated.");
  return stripePriceIdByLookupKey;
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function seedProductionUsers() {
  const sharedPasswordHash = await hash(SEEDED_USER_PASSWORD, 12);
  const sharedEmailVerifiedAt = new Date("2026-04-01T00:00:00.000Z");

  const upsertStaffUser = async (input: { email: string; firstName: string; lastName: string; role: Role; image?: string; phone?: string; bio?: string; specialties?: string[]; certifications?: string[]; hireDate?: Date; lastLoginAt: Date }) => {
    return prisma.user.upsert({
      where: { email: input.email },
      update: {
        name: `${input.firstName} ${input.lastName}`, firstName: input.firstName, lastName: input.lastName,
        role: input.role, passwordHash: sharedPasswordHash,
        emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
        image: input.image, isActive: true, isInactive: false, lastLoginAt: input.lastLoginAt,
      },
      create: {
        name: `${input.firstName} ${input.lastName}`, firstName: input.firstName, lastName: input.lastName,
        email: input.email, role: input.role, passwordHash: sharedPasswordHash,
        emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
        image: input.image, isActive: true, isInactive: false, lastLoginAt: input.lastLoginAt,
        ...(input.role === Role.TEACHER && input.phone && input.bio && input.specialties && input.certifications && input.hireDate
          ? { teacherProfile: { create: { phone: input.phone, bio: input.bio, specialties: input.specialties, certifications: input.certifications, hireDate: input.hireDate } } }
          : {}),
      },
    });
  };

  const masterAdmin = await upsertStaffUser({ email: "master@bookmyclass.app", firstName: "Studio", lastName: "Owner", role: Role.MASTER_ADMIN, lastLoginAt: new Date("2026-04-01T08:00:00.000Z") });
  const admin = await upsertStaffUser({ email: "admin@bookmyclass.app", firstName: "Studio", lastName: "Manager", role: Role.ADMIN, lastLoginAt: new Date("2026-04-01T09:00:00.000Z") });
  const ana = await upsertStaffUser({ email: DEMO_TEACHERS.ana.email, firstName: DEMO_TEACHERS.ana.firstName, lastName: DEMO_TEACHERS.ana.lastName, role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.ana, phone: DEMO_TEACHERS.ana.phone, bio: DEMO_TEACHERS.ana.bio, specialties: [...DEMO_TEACHERS.ana.specialties], certifications: [...DEMO_TEACHERS.ana.certifications], hireDate: new Date("2023-09-01T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T07:30:00.000Z") });
  const elena = await upsertStaffUser({ email: DEMO_TEACHERS.elena.email, firstName: DEMO_TEACHERS.elena.firstName, lastName: DEMO_TEACHERS.elena.lastName, role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.elena, phone: DEMO_TEACHERS.elena.phone, bio: DEMO_TEACHERS.elena.bio, specialties: [...DEMO_TEACHERS.elena.specialties], certifications: [...DEMO_TEACHERS.elena.certifications], hireDate: new Date("2024-02-15T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T10:00:00.000Z") });
  const sofia = await upsertStaffUser({ email: DEMO_TEACHERS.sofia.email, firstName: DEMO_TEACHERS.sofia.firstName, lastName: DEMO_TEACHERS.sofia.lastName, role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.sofia, phone: DEMO_TEACHERS.sofia.phone, bio: DEMO_TEACHERS.sofia.bio, specialties: [...DEMO_TEACHERS.sofia.specialties], certifications: [...DEMO_TEACHERS.sofia.certifications], hireDate: new Date("2024-05-01T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T08:45:00.000Z") });

  // Deterministic Studio Aster clients — upsert by email.
  const testClients: Array<{ id: string; email: string; name: string }> = [];
  for (let index = 0; index < DEMO_CLIENTS.length; index += 1) {
    const [localPart, firstName, lastName, phone, notes] = DEMO_CLIENTS[index]!;
    const email = `${localPart}@bookmyclass.app`;
    const name = `${firstName} ${lastName}`;
    const verifiedAt = new Date(sharedEmailVerifiedAt);
    verifiedAt.setUTCDate(verifiedAt.getUTCDate() + (index % 14));
    const created = await prisma.user.upsert({
      where: { email },
      update: {
        name, firstName, lastName,
        role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false,
      },
      create: {
        name, firstName, lastName,
        email, role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false,
        clientProfile: { create: { phone, notes: notes || null } },
      },
    });
    testClients.push({ id: created.id, email, name });
  }

  console.info(`[seed:demo] Users seeded: master-admin, admin, 3 teachers, ${PROD_CLIENT_COUNT} Studio Aster clients.`);
  return { masterAdmin, admin, teachers: { ana, elena, sofia }, clients: testClients };
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
  const now = hasStripePriceId ? new Date() : null;
  return prisma.price.upsert({
    where: { lookupKey: input.lookupKey },
    update: { productId: input.productId, name: input.name, stripePriceId: input.stripePriceId, stripeSyncStatus, stripeSyncLastAttempt: now, stripeSyncLastSuccess: now, stripeSyncErrorCode: null, stripeSyncError: null, stripeSyncCorrelation: null, priceType: input.priceType, currencyCode: input.currencyCode, unitAmountMinor: input.unitAmountMinor, billingInterval: input.billingInterval, billingIntervalCount: input.billingIntervalCount, isActive: true, isArchived: false, startsAt: new Date("2026-04-01T00:00:00.000Z"), endsAt: null },
    create: { productId: input.productId, lookupKey: input.lookupKey, stripePriceId: input.stripePriceId, stripeSyncStatus, stripeSyncLastAttempt: now, stripeSyncLastSuccess: now, stripeSyncErrorCode: null, stripeSyncError: null, stripeSyncCorrelation: null, name: input.name, priceType: input.priceType, currencyCode: input.currencyCode, unitAmountMinor: input.unitAmountMinor, billingInterval: input.billingInterval, billingIntervalCount: input.billingIntervalCount, isActive: true, isArchived: false, startsAt: new Date("2026-04-01T00:00:00.000Z"), endsAt: null },
  });
}

async function upsertEntitlementRule(input: { productId: string; entitlementType: EntitlementType; entitlementScope: EntitlementScope; quantity?: number; validForDays?: number; notes?: string }) {
  return prisma.entitlementRule.upsert({
    where: { productId_entitlementType_entitlementScope: { productId: input.productId, entitlementType: input.entitlementType, entitlementScope: input.entitlementScope } },
    update: { quantity: input.quantity, validForDays: input.validForDays, notes: input.notes, isActive: true },
    create: { productId: input.productId, entitlementType: input.entitlementType, entitlementScope: input.entitlementScope, quantity: input.quantity, validForDays: input.validForDays, notes: input.notes, isActive: true },
  });
}

async function seedProductionCatalog(stripePriceIdByLookupKey: Record<string, string>) {
  const collectiveDropIn = await upsertProduct({ slug: "collective-drop-in", name: "Drop-in Class", description: "One credit for a single group class. Valid for 30 days from purchase.", productType: ProductType.DROP_IN_CLASS, sortOrder: 10 });
  await upsertPrice({ productId: collectiveDropIn.id, lookupKey: "collective-drop-in-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-drop-in-eur-once-v1"], name: "Drop-in Class", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 2200 });
  await upsertEntitlementRule({ productId: collectiveDropIn.id, entitlementType: EntitlementType.SINGLE_USE, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 1, validForDays: 30 });

  const collectiveFivePack = await upsertProduct({ slug: "collective-5-class-pack", name: "5-Class Pack", description: "Five credits for group classes. Valid for 90 days from purchase.", productType: ProductType.CLASS_PACK, sortOrder: 20 });
  await upsertPrice({ productId: collectiveFivePack.id, lookupKey: "qa-collective-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-collective-5-pack-eur-once-v1"], name: "5-Class Pack", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 9500 });
  await upsertEntitlementRule({ productId: collectiveFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 5, validForDays: 90 });

  const collectiveTenPack = await upsertProduct({ slug: "collective-10-class-pack", name: "10-Class Pack", description: "Ten credits for group classes. Valid for 180 days from purchase.", productType: ProductType.CLASS_PACK, sortOrder: 30 });
  await upsertPrice({ productId: collectiveTenPack.id, lookupKey: "collective-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-10-pack-eur-once-v1"], name: "10-Class Pack", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 17900 });
  await upsertEntitlementRule({ productId: collectiveTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 10, validForDays: 180 });

  const collectiveMonthly = await upsertProduct({ slug: "monthly-unlimited-collective", name: "Unlimited Monthly Membership", description: "Recurring monthly access to eligible group classes.", productType: ProductType.UNLIMITED_MEMBERSHIP, sortOrder: 40 });
  await upsertPrice({ productId: collectiveMonthly.id, lookupKey: "monthly-unlimited-collective-eur-monthly-v1", stripePriceId: stripePriceIdByLookupKey["monthly-unlimited-collective-eur-monthly-v1"], name: "Unlimited Monthly Membership", priceType: PriceType.RECURRING, currencyCode: "EUR", unitAmountMinor: 12900, billingInterval: BillingInterval.MONTH, billingIntervalCount: 1 });
  await upsertEntitlementRule({ productId: collectiveMonthly.id, entitlementType: EntitlementType.UNLIMITED_ACCESS, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, validForDays: 30 });

  const privateFivePack = await upsertProduct({ slug: "private-5-class-pack", name: "5 Private Sessions", description: "Five credits for private sessions. Valid for 180 days from purchase.", productType: ProductType.PRIVATE_PACK, sortOrder: 50 });
  await upsertPrice({ productId: privateFivePack.id, lookupKey: "qa-private-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-5-pack-eur-once-v1"], name: "5 Private Sessions", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 32000 });
  await upsertEntitlementRule({ productId: privateFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 5, validForDays: 180 });

  const privateTenPack = await upsertProduct({ slug: "private-10-class-pack", name: "10 Private Sessions", description: "Ten credits for private sessions. Valid for 240 days from purchase.", productType: ProductType.PRIVATE_PACK, sortOrder: 60 });
  await upsertPrice({ productId: privateTenPack.id, lookupKey: "qa-private-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-10-pack-eur-once-v1"], name: "10 Private Sessions", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 60000 });
  await upsertEntitlementRule({ productId: privateTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 10, validForDays: 240 });

  console.info("[seed:demo] Catalog seeded (6 products).");
  return { collectiveTenPack, collectiveMonthly };
}

async function seedProductionStoreCatalog(stripePriceIdByLookupKey: Record<string, string>) {
  const [firstAdmin] = await prisma.user.findMany({
    where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] } },
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { id: true },
  });
  if (!firstAdmin) {
    throw new Error("Store seed media requires an existing admin user.");
  }

  let copiedCount = 0;
  for (const item of STORE_CATALOG_PRODUCTS) {
    const product = await upsertProduct({
      slug: item.slug,
      name: item.name,
      description: item.description,
      productType: item.productType,
      sortOrder: item.sortOrder,
    });
    await upsertPrice({
      productId: product.id,
      lookupKey: item.price.lookupKey,
      stripePriceId: stripePriceIdByLookupKey[item.price.lookupKey],
      name: item.price.name,
      priceType: item.price.priceType,
      currencyCode: item.price.currencyCode,
      unitAmountMinor: item.price.unitAmountMinor,
    });

    const storageFilename = buildStoreSeedAssetFilename(item.slug);
    const publicPath = `/uploads/products/${storageFilename}`;
    const mediaPlan = buildSeedMediaPlan(publicPath, {
      sourceFolder: "products",
      sourceFilename: item.seedImageSourceFilename,
    });
    await overwriteSeedMediaAsset(mediaPlan);
    copiedCount += 1;

    const sizeBytes = await readSeedFileSizeBytes(mediaPlan.destinationAbsolutePath);
    const mediaAsset = await prisma.mediaAsset.upsert({
      where: { path: publicPath },
      update: {
        mimeType: "image/jpeg",
        sizeBytes,
        originalFilename: storageFilename,
        storageFilename,
        uploadedById: firstAdmin.id,
      },
      create: {
        path: publicPath,
        mimeType: "image/jpeg",
        sizeBytes,
        originalFilename: storageFilename,
        storageFilename,
        uploadedById: firstAdmin.id,
      },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { imageAssetId: mediaAsset.id },
    });
  }
  console.info(
    `[seed:demo] Store catalog seeded: ${STORE_CATALOG_PRODUCTS.length} products (gift cards + merchandise, pickup-only). mediaRefreshed=${copiedCount}.`,
  );
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

async function upsertClassTemplate(input: { slug: string; classTypeId: string; defaultTeacherId: string; title: string; description?: string | null; location?: string | null; defaultCapacity: number; defaultDurationMinutes: number }) {
  return prisma.classTemplate.upsert({
    where: { slug: input.slug },
    update: { classTypeId: input.classTypeId, defaultTeacherId: input.defaultTeacherId, title: input.title, description: input.description, location: input.location, defaultCapacity: input.defaultCapacity, defaultDurationMinutes: input.defaultDurationMinutes, isActive: true, isPublished: true },
    create: { slug: input.slug, classTypeId: input.classTypeId, defaultTeacherId: input.defaultTeacherId, title: input.title, description: input.description, location: input.location, defaultCapacity: input.defaultCapacity, defaultDurationMinutes: input.defaultDurationMinutes, isActive: true, isPublished: true },
  });
}

async function upsertStudioSession(input: { classTemplateId: string; classTypeId: string; teacherId: string; title: string; description?: string; location?: string | null; startsAt: Date; endsAt: Date; capacity: number }) {
  return prisma.studioSession.upsert({
    where: { classTemplateId_startsAt: { classTemplateId: input.classTemplateId, startsAt: input.startsAt } },
    update: { classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, cancelledAt: null, cancelledReason: null, cancelledById: null, isPublished: true },
    create: { classTemplateId: input.classTemplateId, classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, startsAt: input.startsAt, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, isPublished: true },
  });
}

// ─── Schedule + sessions + entitlements + bookings ───────────────────────────

async function seedProductionScheduleAndBookings(input: {
  teachers: { anaId: string; elenaId: string; sofiaId: string };
  clients: Array<{ id: string; email: string; name: string }>;
  collectiveTenPackProductId: string;
  collectiveTenPackPriceId: string;
  collectiveTenPackLookupKey: string;
  collectiveTenPackUnitAmountMinor: number;
  collectiveTenPackCurrencyCode: string;
  collectiveMonthlyProductId: string;
  collectiveMonthlyPriceId: string;
  collectiveMonthlyUnitAmountMinor: number;
  collectiveMonthlyCurrencyCode: string;
}) {
  const rng = createSeededRng(PROD_RANDOM_SEED + 97);
  const { teachers, clients } = input;

  const yogaCategory = await upsertClassCategory({ slug: "yoga", name: "Yoga", description: "Vinyasa and Rocket Yoga classes.", sortOrder: 10 });
  const pilatesCategory = await upsertClassCategory({ slug: "pilates", name: "Pilates", description: "Mat Pilates, stretching and private reformer sessions.", sortOrder: 20 });
  const fitnessCategory = await upsertClassCategory({ slug: "fitness", name: "Fitness", description: "Small-group functional strength and conditioning.", sortOrder: 30 });
  const privateCategory = await upsertClassCategory({ slug: "private-sessions", name: "Private sessions", description: "Individual reformer sessions by appointment.", sortOrder: 40 });

  const vinyasaYoga = await upsertClassType({ slug: "vinyasa-yoga", categoryId: yogaCategory.id, name: "Vinyasa Yoga", description: "A flowing yoga class combining standing sequences, balance, strength and floor work. Options are provided for different experience levels.", imageUrl: SEEDED_CLASS_IMAGES.vinyasaYoga, defaultDurationMinutes: 60, defaultCapacity: 10, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const rocketYoga = await upsertClassType({ slug: "rocket-yoga", categoryId: yogaCategory.id, name: "Rocket Yoga", description: "A faster-paced sequence with repeated transitions, balance work and optional inversion preparation. Previous yoga experience is recommended.", imageUrl: SEEDED_CLASS_IMAGES.rocketYoga, defaultDurationMinutes: 60, defaultCapacity: 10, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const matPilates = await upsertClassType({ slug: "mat-pilates", categoryId: pilatesCategory.id, name: "Mat Pilates", description: "A mat-based class focused on core control, posture, hip stability and coordinated movement.", imageUrl: SEEDED_CLASS_IMAGES.matPilates, defaultDurationMinutes: 55, defaultCapacity: 10, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const pilatesStretching = await upsertClassType({ slug: "pilates-and-stretching", categoryId: pilatesCategory.id, name: "Pilates & Stretching", description: "Controlled Pilates exercises followed by longer mobility and stretching work for the hips, spine and shoulders.", imageUrl: SEEDED_CLASS_IMAGES.reformerFoundations, defaultDurationMinutes: 60, defaultCapacity: 10, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const functionalTraining = await upsertClassType({ slug: "functional-training", categoryId: fitnessCategory.id, name: "Functional Training", description: "Small-group strength and conditioning using bodyweight, dumbbells, kettlebells and simple movement circuits.", imageUrl: SEEDED_CLASS_IMAGES.functionalStrength, defaultDurationMinutes: 45, defaultCapacity: 8, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const privateReformer = await upsertClassType({ slug: "private-reformer", categoryId: privateCategory.id, name: "Private Reformer", description: "An individual reformer session adapted to the client's experience, movement goals and current training needs.", imageUrl: SEEDED_CLASS_IMAGES.privateReformerCoaching, defaultDurationMinutes: 50, defaultCapacity: 1, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.PRIVATE_CLASSES, sortOrder: 10 });

  const vinyasaTemplate = await upsertClassTemplate({ slug: "vinyasa-yoga", classTypeId: vinyasaYoga.id, defaultTeacherId: teachers.anaId, title: "Vinyasa Yoga", description: vinyasaYoga.description, location: null, defaultCapacity: 10, defaultDurationMinutes: 60 });
  const rocketTemplate = await upsertClassTemplate({ slug: "rocket-yoga", classTypeId: rocketYoga.id, defaultTeacherId: teachers.anaId, title: "Rocket Yoga", description: rocketYoga.description, location: null, defaultCapacity: 10, defaultDurationMinutes: 60 });
  const matPilatesTemplate = await upsertClassTemplate({ slug: "mat-pilates", classTypeId: matPilates.id, defaultTeacherId: teachers.elenaId, title: "Mat Pilates", description: matPilates.description, location: null, defaultCapacity: 10, defaultDurationMinutes: 55 });
  const pilatesStretchingTemplate = await upsertClassTemplate({ slug: "pilates-and-stretching", classTypeId: pilatesStretching.id, defaultTeacherId: teachers.elenaId, title: "Pilates & Stretching", description: pilatesStretching.description, location: null, defaultCapacity: 10, defaultDurationMinutes: 60 });
  const functionalTrainingTemplate = await upsertClassTemplate({ slug: "functional-training", classTypeId: functionalTraining.id, defaultTeacherId: teachers.sofiaId, title: "Functional Training", description: functionalTraining.description, location: null, defaultCapacity: 8, defaultDurationMinutes: 45 });
  await upsertClassTemplate({ slug: "private-reformer", classTypeId: privateReformer.id, defaultTeacherId: teachers.elenaId, title: "Private Reformer", description: privateReformer.description, location: null, defaultCapacity: 1, defaultDurationMinutes: 50 });

  // Fixed weekly public timetable covering 6 months forward.
  type SessionSpec = { weekday: Weekday; time: string };
  const templateSchedules: Array<{ template: { id: string; title: string; description: string | null; location: string | null; defaultDurationMinutes: number; defaultCapacity: number }; classTypeId: string; teacherId: string; slots: SessionSpec[] }> = [
    { template: functionalTrainingTemplate, classTypeId: functionalTraining.id, teacherId: teachers.sofiaId, slots: [{ weekday: Weekday.MONDAY, time: "18:00" }] },
    { template: vinyasaTemplate, classTypeId: vinyasaYoga.id, teacherId: teachers.anaId, slots: [{ weekday: Weekday.MONDAY, time: "19:00" }, { weekday: Weekday.TUESDAY, time: "19:15" }, { weekday: Weekday.SATURDAY, time: "11:00" }] },
    { template: matPilatesTemplate, classTypeId: matPilates.id, teacherId: teachers.elenaId, slots: [{ weekday: Weekday.TUESDAY, time: "18:00" }, { weekday: Weekday.THURSDAY, time: "18:00" }] },
    { template: pilatesStretchingTemplate, classTypeId: pilatesStretching.id, teacherId: teachers.elenaId, slots: [{ weekday: Weekday.WEDNESDAY, time: "18:30" }, { weekday: Weekday.THURSDAY, time: "19:15" }] },
    { template: rocketTemplate, classTypeId: rocketYoga.id, teacherId: teachers.anaId, slots: [{ weekday: Weekday.SATURDAY, time: "09:30" }] },
  ];

  type ProdSessionSeed = { id: string; startsAt: Date; capacity: number; classTypeId: string; inBookingWindow: boolean };
  const bookableSessions: ProdSessionSeed[] = [];
  let totalSessionsGenerated = 0;

  for (const entry of templateSchedules) {
    for (const slot of entry.slots) {
      const occurrences = nextOccurrencesInWindow({ weekday: slot.weekday, time: slot.time, windowStart: seedDayUtc, windowEnd: sessionWindowEndUtc });
      for (const startsAt of occurrences) {
        const session = await upsertStudioSession({ classTemplateId: entry.template.id, classTypeId: entry.classTypeId, teacherId: entry.teacherId, title: entry.template.title, description: entry.template.description ?? undefined, location: null, startsAt, endsAt: new Date(startsAt.getTime() + entry.template.defaultDurationMinutes * 60 * 1000), capacity: entry.template.defaultCapacity });
        totalSessionsGenerated += 1;
        if (startsAt <= bookingWindowEndUtc) {
          bookableSessions.push({ id: session.id, startsAt, capacity: entry.template.defaultCapacity, classTypeId: entry.classTypeId, inBookingWindow: true });
        }
      }
    }
  }

  console.info(`[seed:demo] Sessions generated: ${totalSessionsGenerated} total, ${bookableSessions.length} in ${PROD_BOOKING_DAYS}-day booking window.`);

  // Entitlements: first 50 clients get a 10-pack; next 50 get monthly subscription
  const purchasedAt = addDaysUtc(seedDayUtc, -3);
  type ProdEntitlementState = { id: string; orderId: string; priceId: string; unlimitedAccess: boolean; creditsRemaining: number; activatedAt: Date; expiresAt: Date | null };
  const entitlementByClientId = new Map<string, ProdEntitlementState>();

  const tenPackEntitlementRule = await prisma.entitlementRule.findFirst({ where: { productId: input.collectiveTenPackProductId, isActive: true, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES } });
  if (!tenPackEntitlementRule) throw new Error("[seed:demo] 10-pack entitlement rule not found.");
  const monthlyEntitlementRule = await prisma.entitlementRule.findFirst({ where: { productId: input.collectiveMonthlyProductId, isActive: true, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES } });
  if (!monthlyEntitlementRule) throw new Error("[seed:demo] Monthly entitlement rule not found.");

  for (let i = 0; i < clients.length; i += 1) {
    const client = clients[i]!;
    const isMonthly = i >= 50;

    const productId = isMonthly ? input.collectiveMonthlyProductId : input.collectiveTenPackProductId;
    const priceId = isMonthly ? input.collectiveMonthlyPriceId : input.collectiveTenPackPriceId;
    const unitAmountMinor = isMonthly ? input.collectiveMonthlyUnitAmountMinor : input.collectiveTenPackUnitAmountMinor;
    const currencyCode = isMonthly ? input.collectiveMonthlyCurrencyCode : input.collectiveTenPackCurrencyCode;
    const rule = isMonthly ? monthlyEntitlementRule : tenPackEntitlementRule;

    // Skip if client already has an active entitlement for this product to stay idempotent
    const existing = await prisma.clientEntitlement.findFirst({ where: { clientId: client.id, productId, status: ClientEntitlementStatus.ACTIVE } });
    if (existing) {
      const consumed = isMonthly
        ? 0
        : (await prisma.creditLedgerEntry.aggregate({
          where: {
            clientId: client.id,
            entitlementId: existing.id,
            entryType: CreditLedgerEntryType.CONSUME,
          },
          _sum: { amount: true },
        }))._sum.amount ?? 0;
      entitlementByClientId.set(client.id, {
        id: existing.id,
        orderId: existing.orderId!,
        priceId,
        unlimitedAccess: isMonthly,
        creditsRemaining: isMonthly ? Infinity : Math.max(0, 10 + consumed),
        activatedAt: existing.activatedAt ?? purchasedAt,
        expiresAt: existing.expiresAt,
      });
      continue;
    }

    const productNameSnapshot = isMonthly ? "Unlimited Monthly Membership" : "10-Class Pack";
    const priceNameSnapshot = isMonthly ? "Unlimited Monthly Membership" : "10-Class Pack";
    const order = await prisma.order.create({ data: { clientId: client.id, subtotalAmountMinor: unitAmountMinor, discountAmountMinor: 0, totalAmountMinor: unitAmountMinor, currencyCode, status: OrderStatus.PAID, placedAt: purchasedAt, notes: isMonthly ? "seed-prod-monthly-subscription" : "seed-prod-collective-10-pack" } });
    await prisma.orderItem.create({ data: { orderId: order.id, productId, priceId, quantity: 1, productNameSnapshot, priceNameSnapshot, unitAmountMinor, lineSubtotalAmountMinor: unitAmountMinor, lineDiscountAmountMinor: 0, lineTotalAmountMinor: unitAmountMinor, currencyCode } });
    await prisma.payment.create({ data: { orderId: order.id, status: PaymentStatus.SUCCEEDED, method: PaymentMethod.CARD, provider: PaymentProvider.STRIPE, providerReference: `seed-prod-payment-${order.id}`, stripeCheckoutSessionId: `cs_prod_seed_${order.id.slice(0, 16)}`, stripeCustomerId: `cus_prod_${client.id.slice(0, 12)}`, stripeCheckoutMode: isMonthly ? StripeCheckoutMode.SUBSCRIPTION : StripeCheckoutMode.PAYMENT, amountMinor: unitAmountMinor, currencyCode, authorizedAt: purchasedAt, capturedAt: purchasedAt, createdAt: purchasedAt } });

    let expiresAt: Date | null = null;
    let subscriptionContractId: string | null = null;
    if (isMonthly) {
      expiresAt = addMonthsUtc(purchasedAt, 1);
      const contract = await prisma.subscriptionContract.create({ data: { clientId: client.id, productId, priceId, status: SubscriptionStatus.ACTIVE, startsAt: purchasedAt, currentPeriodStart: purchasedAt, currentPeriodEnd: expiresAt, cancelAtPeriodEnd: false, endedAt: null, provider: PaymentProvider.STRIPE, providerSubscriptionReference: `sub_prod_seed_${order.id.slice(0, 16)}` } });
      subscriptionContractId = contract.id;
    } else if (rule.validForDays) {
      expiresAt = addDaysUtc(purchasedAt, rule.validForDays);
    }

    const entitlement = await prisma.clientEntitlement.create({ data: { clientId: client.id, productId, orderId: order.id, subscriptionContractId, entitlementType: rule.entitlementType, entitlementScope: rule.entitlementScope, status: ClientEntitlementStatus.ACTIVE, activatedAt: purchasedAt, expiresAt } });

    if (!isMonthly) {
      await prisma.creditLedgerEntry.create({ data: { clientId: client.id, entryType: CreditLedgerEntryType.GRANT, amount: 10, happenedAt: purchasedAt, entitlementId: entitlement.id, orderId: order.id, notes: "Production seed 10-pack grant" } });
    }

    entitlementByClientId.set(client.id, { id: entitlement.id, orderId: order.id, priceId, unlimitedAccess: isMonthly, creditsRemaining: isMonthly ? Infinity : 10, activatedAt: purchasedAt, expiresAt });
  }

  console.info(`[seed:demo] Entitlements seeded: 50 clients with 10-pack, 50 clients with monthly subscription.`);

  // Pre-populate bookings for sessions within booking window (~40% occupancy)
  let bookingsCreated = 0;
  let clientIndex = 0;
  const bookingWindowSessions = bookableSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const existingBookings = await prisma.booking.findMany({
    where: {
      studioSessionId: { in: bookingWindowSessions.map((session) => session.id) },
      clientId: { not: null },
    },
    select: { clientId: true, studioSessionId: true },
  });
  const bookedPairs = new Set(existingBookings.map((booking) => `${booking.clientId}::${booking.studioSessionId}`));
  const existingBookingCountBySessionId = new Map<string, number>();
  for (const booking of existingBookings) {
    existingBookingCountBySessionId.set(
      booking.studioSessionId,
      (existingBookingCountBySessionId.get(booking.studioSessionId) ?? 0) + 1,
    );
  }

  for (const session of bookingWindowSessions) {
    const daysAhead = Math.floor((session.startsAt.getTime() - seedDayUtc.getTime()) / (1000 * 60 * 60 * 24));
    // Near-term sessions: ~50% occupancy; further sessions: ~25%
    const targetOccupancy = daysAhead <= 30 ? rng.int(5, 9) : rng.int(2, 5);
    let createdForSession = existingBookingCountBySessionId.get(session.id) ?? 0;
    let guard = 0;

    while (createdForSession < targetOccupancy && guard < clients.length * 2) {
      guard += 1;
      const client = clients[clientIndex % clients.length]!;
      clientIndex += 1;
      const pairKey = `${client.id}::${session.id}`;
      if (bookedPairs.has(pairKey)) continue;
      const entitlement = entitlementByClientId.get(client.id);
      if (!entitlement || (!entitlement.unlimitedAccess && entitlement.creditsRemaining <= 0)) continue;
      if (session.startsAt < entitlement.activatedAt) continue;
      if (entitlement.expiresAt && session.startsAt > endOfUtcDay(entitlement.expiresAt)) continue;

      const bookedAt = addDaysUtc(session.startsAt, -rng.int(1, 10));
      const cancellationEligibleUntilAt = new Date(session.startsAt.getTime() - 24 * 60 * 60 * 1000);

      const booking = await prisma.booking.create({
        data: { clientId: client.id, studioSessionId: session.id, orderId: entitlement.orderId, status: BookingStatus.CONFIRMED, bookingIntent: BookingIntent.USE_ENTITLEMENT, paymentSelection: BookingPaymentSelection.EXISTING_PLAN, selectedEntitlementId: entitlement.id, selectedPriceId: entitlement.priceId, bookedAt, customerName: client.name, customerEmail: client.email, consentTermsAccepted: true, consentPrivacyAccepted: true, consentAcceptedAt: bookedAt, cancellationEligibleUntilAt, cancelledAt: null, creditRefundedAt: null },
      });
      bookedPairs.add(pairKey);

      if (!entitlement.unlimitedAccess) {
        entitlement.creditsRemaining -= 1;
        await prisma.creditLedgerEntry.create({ data: { clientId: client.id, entryType: CreditLedgerEntryType.CONSUME, amount: -1, happenedAt: bookedAt, entitlementId: entitlement.id, bookingId: booking.id, orderId: entitlement.orderId, notes: "Production seed booking credit consumption" } });
      }

      createdForSession += 1;
      bookingsCreated += 1;
    }
  }

  console.info(`[seed:demo] Bookings created: ${bookingsCreated} across ${bookingWindowSessions.length} sessions in booking window.`);
  return { totalSessionsGenerated, bookableSessionCount: bookableSessions.length, bookingsCreated };
}

// ─── Learning ─────────────────────────────────────────────────────────────────

async function seedProductionLearning() {
  const programs = [FITNESS_PROGRAM, YOGA_PROGRAM, PILATES_PROGRAM];
  const allCourses = [...FITNESS_COURSES, ...YOGA_COURSES, ...PILATES_COURSES];
  const courseLegacyIds = allCourses.map((course) => course.legacyId);

  // Validate image paths at seed time (assertLearningImagePath validates format, not disk).
  for (const program of programs) {
    assertLearningImagePath(toCanonicalSeedImagePath(program.picture1), `${program.legacyId} picture1`);
    assertLearningImagePath(toCanonicalSeedImagePath(program.picture2), `${program.legacyId} picture2`);
    assertLearningImagePath(toCanonicalSeedImagePath(program.picture3), `${program.legacyId} picture3`);
  }
  for (const course of allCourses) {
    assertLearningImagePath(toCanonicalSeedImagePath(course.thumbnail), `${course.legacyId} thumbnail`);
  }

  for (const program of programs) {
    await prisma.learningProgram.upsert({
      where: { legacyId: program.legacyId },
      update: { mainDescription: program.mainDescription, courseType: program.courseType, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 },
      create: { legacyId: program.legacyId, mainDescription: program.mainDescription, courseType: program.courseType, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 },
    });
  }

  for (const course of allCourses) {
    await prisma.learningCourse.upsert({
      where: { legacyId: course.legacyId },
      update: { title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority },
      create: { legacyId: course.legacyId, title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority },
    });
  }

  await prisma.learningCourse.deleteMany({
    where: {
      legacyId: {
        startsWith: "prod-",
        notIn: courseLegacyIds,
      },
    },
  });

  console.info(`[seed:demo] Learning seeded: ${programs.length} programmes, ${allCourses.length} courses.`);
  return { programCount: programs.length, courseCount: allCourses.length };
}

// ─── Agenda schedule ──────────────────────────────────────────────────────────

async function seedAgendaSchedule() {
  assertDemoScheduleAgreement();
  for (let index = 0; index < DEMO_WEEKLY_SCHEDULE.length; index += 1) {
    const entry = DEMO_WEEKLY_SCHEDULE[index]!;
    await prisma.siteWeeklyScheduleEntry.upsert({
      where: { id: `seed-schedule-${entry.dayOfWeek}-${index}` },
      update: { dayOfWeek: entry.dayOfWeek, startTime: entry.startTime, endTime: entry.endTime, label: entry.label, displayOrder: index + 1, isActive: true },
      create: { id: `seed-schedule-${entry.dayOfWeek}-${index}`, dayOfWeek: entry.dayOfWeek, startTime: entry.startTime, endTime: entry.endTime, label: entry.label, displayOrder: index + 1, isActive: true },
    });
  }
  console.info(`[seed:demo] Agenda schedule seeded: ${DEMO_WEEKLY_SCHEDULE.length} entries.`);
}

// ─── Marketing history ────────────────────────────────────────────────────────

async function seedProductionMarketingHistory(input: { createdById: string }) {
  const launchCategory = await prisma.marketingCategory.upsert({
    where: { slug: "launch" }, update: { name: "Launch", isActive: true },
    create: { name: "Launch", slug: "launch", isActive: true },
  });
  const newsCategory = await prisma.marketingCategory.upsert({
    where: { slug: "newsletter" }, update: { name: "Newsletter", isActive: true },
    create: { name: "Newsletter", slug: "newsletter", isActive: true },
  });

  const launchSentAt = new Date("2026-04-01T10:00:00.000Z");
  await prisma.marketingCampaign.upsert({
    where: { id: "prod-seed-marketing-launch" },
    update: { name: "Summer Schedule Update", status: MarketingCampaignStatus.SENT, categoryId: launchCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Studio Aster summer schedule update", previewText: "Small changes to evening classes and Saturday yoga.", fromName: "Studio Aster", fromEmail: "hello@bookmyclass.app", replyTo: "hello@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "Summer Schedule Update" }, { type: "paragraph", text: "The weekly timetable now includes Thursday Pilates & Stretching and Saturday morning Rocket Yoga." }, { type: "button", text: "View schedule", url: "https://demo.bookmyclass.app/book-a-class" }] }, htmlSnapshot: "<html><body><h2>Summer Schedule Update</h2><p>The weekly timetable now includes Thursday Pilates & Stretching and Saturday morning Rocket Yoga.</p></body></html>", sentAt: launchSentAt, createdById: input.createdById },
    create: { id: "prod-seed-marketing-launch", name: "Summer Schedule Update", status: MarketingCampaignStatus.SENT, categoryId: launchCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Studio Aster summer schedule update", previewText: "Small changes to evening classes and Saturday yoga.", fromName: "Studio Aster", fromEmail: "hello@bookmyclass.app", replyTo: "hello@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "Summer Schedule Update" }, { type: "paragraph", text: "The weekly timetable now includes Thursday Pilates & Stretching and Saturday morning Rocket Yoga." }, { type: "button", text: "View schedule", url: "https://demo.bookmyclass.app/book-a-class" }] }, htmlSnapshot: "<html><body><h2>Summer Schedule Update</h2><p>The weekly timetable now includes Thursday Pilates & Stretching and Saturday morning Rocket Yoga.</p></body></html>", sentAt: launchSentAt, createdById: input.createdById },
  });

  const sampleRecipients = [
    { id: "prod-seed-mkt-rec-01", email: "emma.desmet@bookmyclass.app", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:18.000Z"), openedAt: new Date("2026-04-01T10:15:00.000Z"), clickedAt: new Date("2026-04-01T10:17:00.000Z") },
    { id: "prod-seed-mkt-rec-02", email: "laura.martin@bookmyclass.app", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:20.000Z"), openedAt: null, clickedAt: null },
    { id: "prod-seed-mkt-rec-03", email: "camille.dubois@bookmyclass.app", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:22.000Z"), openedAt: new Date("2026-04-01T11:00:00.000Z"), clickedAt: null },
    { id: "prod-seed-mkt-rec-04", email: "sofia.janssens@bookmyclass.app", status: MarketingRecipientStatus.BOUNCED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: null, openedAt: null, clickedAt: null },
    { id: "prod-seed-mkt-rec-05", email: "marta.kovacs@bookmyclass.app", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:25.000Z"), openedAt: new Date("2026-04-01T14:20:00.000Z"), clickedAt: new Date("2026-04-01T14:22:00.000Z") },
  ];

  for (const rec of sampleRecipients) {
    await prisma.marketingCampaignRecipient.upsert({
      where: { id: rec.id },
      update: { campaignId: "prod-seed-marketing-launch", userId: null, email: rec.email, status: rec.status, sentAt: rec.sentAt, deliveredAt: rec.deliveredAt, openedAt: rec.openedAt, clickedAt: rec.clickedAt, unsubscribedAt: null },
      create: { id: rec.id, campaignId: "prod-seed-marketing-launch", userId: null, email: rec.email, status: rec.status, sentAt: rec.sentAt, deliveredAt: rec.deliveredAt, openedAt: rec.openedAt, clickedAt: rec.clickedAt, unsubscribedAt: null },
    });
  }

  // Draft newsletter ready to send
  await prisma.marketingCampaign.upsert({
    where: { id: "prod-seed-marketing-newsletter-draft" },
    update: { name: "New Thursday Pilates & Stretching", status: MarketingCampaignStatus.DRAFT, categoryId: newsCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "New Thursday Pilates & Stretching", previewText: "A second evening Pilates & Stretching class is now on the demo timetable.", fromName: "Studio Aster", fromEmail: "hello@bookmyclass.app", replyTo: "hello@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "New Thursday Pilates & Stretching" }, { type: "paragraph", text: "The Thursday evening schedule now includes Mat Pilates and Pilates & Stretching." }] }, htmlSnapshot: null, sentAt: null, createdById: input.createdById },
    create: { id: "prod-seed-marketing-newsletter-draft", name: "New Thursday Pilates & Stretching", status: MarketingCampaignStatus.DRAFT, categoryId: newsCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "New Thursday Pilates & Stretching", previewText: "A second evening Pilates & Stretching class is now on the demo timetable.", fromName: "Studio Aster", fromEmail: "hello@bookmyclass.app", replyTo: "hello@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "New Thursday Pilates & Stretching" }, { type: "paragraph", text: "The Thursday evening schedule now includes Mat Pilates and Pilates & Stretching." }] }, createdById: input.createdById },
  });

  console.info("[seed:demo] Marketing history seeded (1 sent campaign, 5 recipients, 1 draft).");
}

// ─── Verification ─────────────────────────────────────────────────────────────

async function verifyProductionSeed(expected: { programCount: number; courseCount: number; totalSessionsGenerated: number; bookableSessionCount: number; bookingsCreated: number }) {
  const [totalClients, totalAdmins, totalTeachers, totalProducts, programCount, courseCount, scheduleCount] = await prisma.$transaction([
    prisma.user.count({ where: { role: Role.CLIENT, email: { endsWith: "@bookmyclass.app" } } }),
    prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] }, email: { endsWith: "@bookmyclass.app" } } }),
    prisma.user.count({ where: { role: Role.TEACHER, email: { endsWith: "@bookmyclass.app" } } }),
    prisma.product.count({ where: { isActive: true, isArchived: false } }),
    prisma.learningProgram.count(),
    prisma.learningCourse.count(),
    prisma.siteWeeklyScheduleEntry.count({ where: { isActive: true } }),
  ]);

  if (totalClients < PROD_CLIENT_COUNT) throw new Error(`Production seed verification: expected at least ${PROD_CLIENT_COUNT} @bookmyclass.app clients, got ${totalClients}.`);
  if (totalAdmins !== 2) throw new Error(`Production seed verification: expected 2 admin/master-admin users, got ${totalAdmins}.`);
  if (totalTeachers !== 3) throw new Error(`Production seed verification: expected 3 teachers, got ${totalTeachers}.`);
  const expectedProductCount = 6 + STORE_CATALOG_PRODUCT_COUNT;
  if (totalProducts !== expectedProductCount) throw new Error(`Production seed verification: expected ${expectedProductCount} active products, got ${totalProducts}.`);
  if (programCount < expected.programCount) throw new Error(`Production seed verification: expected ${expected.programCount} learning programmes, got ${programCount}.`);
  if (courseCount < expected.courseCount) throw new Error(`Production seed verification: expected ${expected.courseCount} learning courses, got ${courseCount}.`);
  if (scheduleCount === 0) throw new Error("Production seed verification: no agenda schedule entries found.");
  if (expected.totalSessionsGenerated === 0) throw new Error("Production seed verification: no sessions were generated.");

  const confirmedBookings = await prisma.booking.count({ where: { status: BookingStatus.CONFIRMED } });
  if (confirmedBookings === 0) throw new Error("Production seed verification: no confirmed bookings were created.");

  console.info(`[seed:demo] Verification passed. clients=${totalClients}, admins=${totalAdmins}, teachers=${totalTeachers}, products=${totalProducts}, programmes=${programCount}, courses=${courseCount}, sessions=${expected.totalSessionsGenerated}, bookableSessions=${expected.bookableSessionCount}, bookings=${expected.bookingsCreated}, scheduleEntries=${scheduleCount}.`);
}

async function syncSeedMediaFilesFromDatabase(): Promise<{ copiedCount: number; existingCount: number }> {
  const [users, classTypes, programs, courses, storeAssets] = await prisma.$transaction([
    prisma.user.findMany({ where: { image: { startsWith: "/uploads/" } }, select: { image: true } }),
    prisma.classType.findMany({ where: { imageUrl: { startsWith: "/uploads/" } }, select: { imageUrl: true } }),
    prisma.learningProgram.findMany({
      where: {
        OR: [
          { picture1: { startsWith: "/uploads/" } },
          { picture2: { startsWith: "/uploads/" } },
          { picture3: { startsWith: "/uploads/" } },
        ],
      },
      select: { picture1: true, picture2: true, picture3: true },
    }),
    prisma.learningCourse.findMany({ where: { thumbnail: { startsWith: "/uploads/" } }, select: { thumbnail: true } }),
    prisma.mediaAsset.findMany({ where: { path: { startsWith: "/uploads/products/" } }, select: { path: true } }),
  ]);

  const paths = new Set<string>();
  for (const row of users) if (row.image) paths.add(row.image);
  for (const row of classTypes) if (row.imageUrl) paths.add(row.imageUrl);
  for (const row of programs) {
    if (row.picture1) paths.add(row.picture1);
    if (row.picture2) paths.add(row.picture2);
    if (row.picture3) paths.add(row.picture3);
  }
  for (const row of courses) if (row.thumbnail) paths.add(row.thumbnail);
  for (const row of storeAssets) paths.add(row.path);

  let copiedCount = 0;
  let existingCount = 0;
  for (const mediaPath of paths) {
    const result = await syncSeedMediaPath(mediaPath);
    if (result === "copied") copiedCount += 1;
    else existingCount += 1;
  }

  return { copiedCount, existingCount };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runDemoSeed(): Promise<void> {
  console.info("[seed:demo] Starting demo seed (mode: demo — upsert-only, no purge).");
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  const { masterAdmin: _master, admin, teachers, clients } = await seedProductionUsers();
  await seedBookingPolicy();
  const { collectiveTenPack, collectiveMonthly } = await seedProductionCatalog(stripePriceIdByLookupKey);
  await seedProductionStoreCatalog(stripePriceIdByLookupKey);

  // Resolve price and entitlement rule IDs needed for booking seeding
  const tenPackPrice = await prisma.price.findUnique({ where: { lookupKey: "collective-10-pack-eur-once-v1" } });
  if (!tenPackPrice) throw new Error("[seed:demo] 10-pack price not persisted — catalog seed must run first.");
  const monthlyPrice = await prisma.price.findUnique({ where: { lookupKey: "monthly-unlimited-collective-eur-monthly-v1" } });
  if (!monthlyPrice) throw new Error("[seed:demo] Monthly price not persisted — catalog seed must run first.");

  const schedulingSummary = await seedProductionScheduleAndBookings({
    teachers: { anaId: teachers.ana.id, elenaId: teachers.elena.id, sofiaId: teachers.sofia.id },
    clients,
    collectiveTenPackProductId: collectiveTenPack.id,
    collectiveTenPackPriceId: tenPackPrice.id,
    collectiveTenPackLookupKey: tenPackPrice.lookupKey,
    collectiveTenPackUnitAmountMinor: tenPackPrice.unitAmountMinor,
    collectiveTenPackCurrencyCode: tenPackPrice.currencyCode,
    collectiveMonthlyProductId: collectiveMonthly.id,
    collectiveMonthlyPriceId: monthlyPrice.id,
    collectiveMonthlyUnitAmountMinor: monthlyPrice.unitAmountMinor,
    collectiveMonthlyCurrencyCode: monthlyPrice.currencyCode,
  });

  const learningSummary = await seedProductionLearning();
  await seedAgendaSchedule();
  await seedProductionMarketingHistory({ createdById: admin.id });
  const mediaSyncSummary = await syncSeedMediaFilesFromDatabase();
  console.info(
    `[seed:demo] Seed media sync: copied=${mediaSyncSummary.copiedCount}, existing=${mediaSyncSummary.existingCount}.`,
  );
  const seededMediaPathCount = await verifySeededMediaReferences(prisma);
  console.info(`[seed:demo] Seeded media verified: ${seededMediaPathCount} canonical /uploads paths.`);
  await verifyProductionSeed({ ...learningSummary, ...schedulingSummary });

  console.info(`[seed:demo] Completed: clients=${PROD_CLIENT_COUNT}, sessions=${schedulingSummary.totalSessionsGenerated}, bookings=${schedulingSummary.bookingsCreated}, programmes=${learningSummary.programCount}, courses=${learningSummary.courseCount}.`);
}





