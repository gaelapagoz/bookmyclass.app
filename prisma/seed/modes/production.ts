/**
 * Production seed mode — safe launch seed for the production environment.
 * Upsert-only (no purge): safe to re-run at any time without data loss.
 * All seeded users have @bookmyclass.app or @test.user emails.
 * Password for all accounts: Book4Ever!
 *
 * Creates:
 *   - 5 staff users (master-admin, admin, 3 teachers)
 *   - 100 test clients (@test.user)
 *   - 6 products (same catalog slugs as dev/perf)
 *   - 6 class templates with 6 months of sessions (3 slots/week/template)
 *   - 3 learning programmes with 20 courses each
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
import { AGENDA_SCHEDULE } from "../data/schedule";
import { STORE_CATALOG_PRODUCT_COUNT, STORE_CATALOG_PRODUCTS } from "../data/store-catalog";
import {
  PILATES_COURSES,
  PILATES_PROGRAM,
  PROD_LEARNING_IMAGE_FITNESS,
  PROD_LEARNING_IMAGE_PILATES,
  PROD_LEARNING_IMAGE_YOGA,
  FITNESS_COURSES,
  FITNESS_PROGRAM,
  YOGA_COURSES,
  YOGA_PROGRAM,
} from "../data/learning-production";
import { createSeededRng } from "../utils/deterministic-random";
import {
  buildSeedMediaPlan,
  buildStoreSeedAssetFilename,
  readSeedFileSizeBytes,
  syncSeedMediaAsset,
  syncSeedMediaPath,
  toCanonicalSeedImagePath,
  verifySeededMediaReferences,
} from "../utils/seed-media";

// ─── Constants ───────────────────────────────────────────────────────────────

const PROD_CLIENT_COUNT = 100;
const PROD_FUTURE_WEEKS = 26; // ≈ 6 months of sessions
const PROD_BOOKING_DAYS = 120; // pre-populate bookings this far ahead
const PROD_RANDOM_SEED = 20260420;
const PROD_SESSION_CAPACITY = 15;

const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]+$/;

type CatalogStripePriceEnvSpec = { productName: string; lookupKey: string; envVarName: string };

const PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS: CatalogStripePriceEnvSpec[] = [
  { productName: "Collective Class Drop-In", lookupKey: "collective-drop-in-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_DROP_IN" },
  { productName: "5-Ticket Collective Classes", lookupKey: "qa-collective-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_5_PACK" },
  { productName: "10-Ticket Collective Classes", lookupKey: "collective-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_10_PACK" },
  { productName: "Monthly Recurrent Collective Subscription", lookupKey: "monthly-unlimited-collective-eur-monthly-v1", envVarName: "STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE" },
  { productName: "5-Ticket Private Classes", lookupKey: "qa-private-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_5_PACK" },
  { productName: "10-Ticket Private Classes", lookupKey: "qa-private-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_10_PACK" },
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

  console.info("[seed:prod] Stripe price configuration validated.");
  return stripePriceIdByLookupKey;
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function seedProductionUsers() {
  const sharedPasswordHash = await hash("Book4Ever!", 12);
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

  const masterAdmin = await upsertStaffUser({ email: "master@bookmyclass.app", firstName: "Master", lastName: "Admin", role: Role.MASTER_ADMIN, lastLoginAt: new Date("2026-04-01T08:00:00.000Z") });
  const admin = await upsertStaffUser({ email: "admin@bookmyclass.app", firstName: "Studio", lastName: "Admin", role: Role.ADMIN, lastLoginAt: new Date("2026-04-01T09:00:00.000Z") });
  const ana = await upsertStaffUser({ email: "ana@bookmyclass.app", firstName: "Ana", lastName: "Ionescu", role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.ana, phone: "+32000000001", bio: "Ana leads classes with a clear and progressive approach to technique, breath, and confidence in movement.", specialties: ["Yoga", "Pilates"], certifications: ["RYT-200"], hireDate: new Date("2023-09-01T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T07:30:00.000Z") });
  const elena = await upsertStaffUser({ email: "elena@bookmyclass.app", firstName: "Elena", lastName: "Moreau", role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.elena, phone: "+32000000003", bio: "Elena brings a calm, precise teaching style focused on alignment, strength, and confidence in movement.", specialties: ["Pilates", "Mobility"], certifications: ["Comprehensive Pilates"], hireDate: new Date("2024-02-15T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T10:00:00.000Z") });
  const sofia = await upsertStaffUser({ email: "sofia@bookmyclass.app", firstName: "Sofia", lastName: "Van den Berg", role: Role.TEACHER, image: SEEDED_TEACHER_IMAGES.sofia, phone: "+32000000004", bio: "Sofia teaches flowing classes with a warm and supportive approach.", specialties: ["Yoga", "Stretch"], certifications: ["RYT-500"], hireDate: new Date("2024-05-01T00:00:00.000Z"), lastLoginAt: new Date("2026-04-01T08:45:00.000Z") });

  // 100 @test.user clients — upsert by email
  const testClients: Array<{ id: string; email: string; name: string }> = [];
  for (let index = 0; index < PROD_CLIENT_COUNT; index += 1) {
    const clientNumber = String(index + 1).padStart(3, "0");
    const email = `client-${clientNumber}@test.user`;
    const name = `Test Client ${clientNumber}`;
    const verifiedAt = new Date(sharedEmailVerifiedAt);
    verifiedAt.setUTCDate(verifiedAt.getUTCDate() + (index % 14));
    const created = await prisma.user.upsert({
      where: { email },
      update: {
        name, firstName: "Test", lastName: `Client ${clientNumber}`,
        role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false,
      },
      create: {
        name, firstName: "Test", lastName: `Client ${clientNumber}`,
        email, role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false,
        clientProfile: { create: { phone: `+3203${clientNumber.padStart(8, "0")}`, notes: "Production launch test client." } },
      },
    });
    testClients.push({ id: created.id, email, name });
  }

  console.info(`[seed:prod] Users seeded: master-admin, admin, 3 teachers, ${PROD_CLIENT_COUNT} test clients.`);
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
  const collectiveDropIn = await upsertProduct({ slug: "collective-drop-in", name: "Collective Class Drop-In", description: "Single booking access for collective yoga, pilates and functional classes.", productType: ProductType.DROP_IN_CLASS, sortOrder: 10 });
  await upsertPrice({ productId: collectiveDropIn.id, lookupKey: "collective-drop-in-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-drop-in-eur-once-v1"], name: "Collective Drop-In - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 2200 });
  await upsertEntitlementRule({ productId: collectiveDropIn.id, entitlementType: EntitlementType.SINGLE_USE, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 1, validForDays: 30 });

  const collectiveFivePack = await upsertProduct({ slug: "collective-5-class-pack", name: "5-Ticket Collective Classes", description: "Five class credits for collective classes.", productType: ProductType.CLASS_PACK, sortOrder: 20 });
  await upsertPrice({ productId: collectiveFivePack.id, lookupKey: "qa-collective-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-collective-5-pack-eur-once-v1"], name: "5-Class Pack - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 9500 });
  await upsertEntitlementRule({ productId: collectiveFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 5, validForDays: 90 });

  const collectiveTenPack = await upsertProduct({ slug: "collective-10-class-pack", name: "10-Ticket Collective Classes", description: "Ten class credits for collective classes.", productType: ProductType.CLASS_PACK, sortOrder: 30 });
  await upsertPrice({ productId: collectiveTenPack.id, lookupKey: "collective-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["collective-10-pack-eur-once-v1"], name: "10-Class Pack - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 17900 });
  await upsertEntitlementRule({ productId: collectiveTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, quantity: 10, validForDays: 180 });

  const collectiveMonthly = await upsertProduct({ slug: "monthly-unlimited-collective", name: "Monthly Recurrent Collective Subscription", description: "Recurring monthly subscription for collective classes.", productType: ProductType.UNLIMITED_MEMBERSHIP, sortOrder: 40 });
  await upsertPrice({ productId: collectiveMonthly.id, lookupKey: "monthly-unlimited-collective-eur-monthly-v1", stripePriceId: stripePriceIdByLookupKey["monthly-unlimited-collective-eur-monthly-v1"], name: "Monthly Unlimited Collective - Monthly", priceType: PriceType.RECURRING, currencyCode: "EUR", unitAmountMinor: 12900, billingInterval: BillingInterval.MONTH, billingIntervalCount: 1 });
  await upsertEntitlementRule({ productId: collectiveMonthly.id, entitlementType: EntitlementType.UNLIMITED_ACCESS, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES, validForDays: 30 });

  const privateFivePack = await upsertProduct({ slug: "private-5-class-pack", name: "5-Ticket Private Classes", description: "Five private class credits.", productType: ProductType.PRIVATE_PACK, sortOrder: 50 });
  await upsertPrice({ productId: privateFivePack.id, lookupKey: "qa-private-5-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-5-pack-eur-once-v1"], name: "5-Private Sessions - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 32000 });
  await upsertEntitlementRule({ productId: privateFivePack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 5, validForDays: 180 });

  const privateTenPack = await upsertProduct({ slug: "private-10-class-pack", name: "10-Ticket Private Classes", description: "Ten private class credits.", productType: ProductType.PRIVATE_PACK, sortOrder: 60 });
  await upsertPrice({ productId: privateTenPack.id, lookupKey: "qa-private-10-pack-eur-once-v1", stripePriceId: stripePriceIdByLookupKey["qa-private-10-pack-eur-once-v1"], name: "10-Private Sessions - One Time", priceType: PriceType.ONE_TIME, currencyCode: "EUR", unitAmountMinor: 60000 });
  await upsertEntitlementRule({ productId: privateTenPack.id, entitlementType: EntitlementType.CREDIT_PACK, entitlementScope: EntitlementScope.PRIVATE_CLASSES, quantity: 10, validForDays: 240 });

  console.info("[seed:prod] Catalog seeded (6 products).");
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
  let existingCount = 0;
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
    const syncResult = await syncSeedMediaAsset(mediaPlan);
    if (syncResult === "copied") copiedCount += 1;
    else existingCount += 1;

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
    `[seed:prod] Store catalog seeded: ${STORE_CATALOG_PRODUCTS.length} products (gift cards + merchandise, pickup-only). mediaCopied=${copiedCount}, mediaExisting=${existingCount}.`,
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

  const yogaCategory = await upsertClassCategory({ slug: "yoga-collective-classes", name: "Yoga Collective Classes", description: "Dynamic and restorative yoga classes for collective groups.", sortOrder: 10 });
  const pilatesCategory = await upsertClassCategory({ slug: "pilates-collective-classes", name: "Pilates Collective Classes", description: "Mat and reformer-inspired pilates sessions in small groups.", sortOrder: 20 });
  const fitnessCategory = await upsertClassCategory({ slug: "fitness-functional", name: "Fitness & Functional", description: "Strength, mobility, and conditioning sessions.", sortOrder: 30 });
  const privateCategory = await upsertClassCategory({ slug: "private-reformer-coach", name: "Private Reformer Coach", description: "Private reformer coaching and technique refinement.", sortOrder: 40 });

  const vinyasaYoga = await upsertClassType({ slug: "vinyasa-yoga", categoryId: yogaCategory.id, name: "Vinyasa Yoga", description: "Breath-led flowing yoga for strength and mobility.", imageUrl: SEEDED_CLASS_IMAGES.vinyasaYoga, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const rocketYoga = await upsertClassType({ slug: "rocket-yoga", categoryId: yogaCategory.id, name: "Rocket Yoga", description: "High-energy yoga sequencing with progressive options.", imageUrl: SEEDED_CLASS_IMAGES.rocketYoga, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const hathaYoga = await upsertClassType({ slug: "hatha-yoga", categoryId: yogaCategory.id, name: "Hatha Yoga", description: "Slower paced foundational yoga and alignment practice.", imageUrl: SEEDED_CLASS_IMAGES.hathaYoga, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 30 });
  const matPilates = await upsertClassType({ slug: "mat-pilates", categoryId: pilatesCategory.id, name: "Mat Pilates", description: "Core-driven pilates session suitable for all levels.", imageUrl: SEEDED_CLASS_IMAGES.matPilates, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const reformerFoundations = await upsertClassType({ slug: "reformer-foundations", categoryId: pilatesCategory.id, name: "Reformer Foundations", description: "Small group reformer fundamentals for technique and control.", imageUrl: SEEDED_CLASS_IMAGES.reformerFoundations, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const functionalStrength = await upsertClassType({ slug: "functional-strength", categoryId: fitnessCategory.id, name: "Functional Strength", description: "Strength and conditioning with athletic movement patterns.", imageUrl: SEEDED_CLASS_IMAGES.functionalStrength, defaultDurationMinutes: 30, defaultCapacity: PROD_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const privateReformerCoaching = await upsertClassType({ slug: "private-reformer-coaching", categoryId: privateCategory.id, name: "Private Reformer Coaching", description: "Private 1:1 or duo coaching on the reformer.", imageUrl: SEEDED_CLASS_IMAGES.privateReformerCoaching, defaultDurationMinutes: 30, defaultCapacity: 1, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.PRIVATE_CLASSES, sortOrder: 10 });

  const vinyasaTemplate = await upsertClassTemplate({ slug: "vinyasa-flow-brussels", classTypeId: vinyasaYoga.id, defaultTeacherId: teachers.anaId, title: "Vinyasa Flow Brussels", description: "A full-spectrum vinyasa class with warm-up, flow and cooldown.", location: "Ixelles Studio A", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const rocketTemplate = await upsertClassTemplate({ slug: "rocket-yoga-power-sequence", classTypeId: rocketYoga.id, defaultTeacherId: teachers.sofiaId, title: "Rocket Yoga Power Sequence", description: "Progressive rocket yoga with core and inversion prep.", location: "Ixelles Studio B", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const hathaTemplate = await upsertClassTemplate({ slug: "hatha-reset-weekend", classTypeId: hathaYoga.id, defaultTeacherId: teachers.anaId, title: "Hatha Reset Weekend", description: "Grounding hatha class focused on breath and posture quality.", location: "Ixelles Studio A", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const matPilatesTemplate = await upsertClassTemplate({ slug: "mat-pilates-core-lab", classTypeId: matPilates.id, defaultTeacherId: teachers.elenaId, title: "Mat Pilates Core Lab", description: "Core and glute-focused mat pilates with progression options.", location: "Etterbeek Studio C", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const reformerTemplate = await upsertClassTemplate({ slug: "reformer-foundations-small-group", classTypeId: reformerFoundations.id, defaultTeacherId: teachers.elenaId, title: "Reformer Foundations Small Group", description: "Technique-first reformer foundations for beginners.", location: "Ixelles Reformer Room", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const functionalTemplate = await upsertClassTemplate({ slug: "functional-strength-express", classTypeId: functionalStrength.id, defaultTeacherId: teachers.sofiaId, title: "Functional Strength Express", description: "High-focus functional strength class with mobility warm-up.", location: "Etterbeek Performance Room", defaultCapacity: PROD_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  await upsertClassTemplate({ slug: "private-reformer-coaching-slot", classTypeId: privateReformerCoaching.id, defaultTeacherId: teachers.anaId, title: "Private Reformer Coaching", description: "Private coaching slot tailored to goals and mobility.", location: "Ixelles Private Studio", defaultCapacity: 1, defaultDurationMinutes: 30 });

  // 3 fixed weekly slots per template covering 6 months forward
  type SessionSpec = { weekday: Weekday; time: string };
  const templateSchedules: Array<{ template: { id: string; title: string; description: string | null; location: string | null }; classTypeId: string; teacherId: string; slots: SessionSpec[] }> = [
    { template: vinyasaTemplate, classTypeId: vinyasaYoga.id, teacherId: teachers.anaId, slots: [{ weekday: Weekday.MONDAY, time: "07:00" }, { weekday: Weekday.WEDNESDAY, time: "07:00" }, { weekday: Weekday.FRIDAY, time: "19:30" }] },
    { template: rocketTemplate, classTypeId: rocketYoga.id, teacherId: teachers.sofiaId, slots: [{ weekday: Weekday.TUESDAY, time: "09:00" }, { weekday: Weekday.WEDNESDAY, time: "19:30" }, { weekday: Weekday.SATURDAY, time: "09:00" }] },
    { template: hathaTemplate, classTypeId: hathaYoga.id, teacherId: teachers.anaId, slots: [{ weekday: Weekday.MONDAY, time: "12:00" }, { weekday: Weekday.FRIDAY, time: "07:00" }, { weekday: Weekday.SUNDAY, time: "09:30" }] },
    { template: matPilatesTemplate, classTypeId: matPilates.id, teacherId: teachers.elenaId, slots: [{ weekday: Weekday.MONDAY, time: "09:00" }, { weekday: Weekday.THURSDAY, time: "18:00" }, { weekday: Weekday.FRIDAY, time: "12:00" }] },
    { template: reformerTemplate, classTypeId: reformerFoundations.id, teacherId: teachers.elenaId, slots: [{ weekday: Weekday.TUESDAY, time: "18:00" }, { weekday: Weekday.THURSDAY, time: "09:00" }, { weekday: Weekday.SATURDAY, time: "10:30" }] },
    { template: functionalTemplate, classTypeId: functionalStrength.id, teacherId: teachers.sofiaId, slots: [{ weekday: Weekday.MONDAY, time: "18:00" }, { weekday: Weekday.WEDNESDAY, time: "12:00" }, { weekday: Weekday.THURSDAY, time: "19:30" }] },
  ];

  type ProdSessionSeed = { id: string; startsAt: Date; capacity: number; classTypeId: string; inBookingWindow: boolean };
  const bookableSessions: ProdSessionSeed[] = [];
  let totalSessionsGenerated = 0;

  for (const entry of templateSchedules) {
    for (const slot of entry.slots) {
      const occurrences = nextOccurrencesInWindow({ weekday: slot.weekday, time: slot.time, windowStart: seedDayUtc, windowEnd: sessionWindowEndUtc });
      for (const startsAt of occurrences) {
        const session = await upsertStudioSession({ classTemplateId: entry.template.id, classTypeId: entry.classTypeId, teacherId: entry.teacherId, title: entry.template.title, description: entry.template.description ?? undefined, location: entry.template.location ?? undefined, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000), capacity: PROD_SESSION_CAPACITY });
        totalSessionsGenerated += 1;
        if (startsAt <= bookingWindowEndUtc) {
          bookableSessions.push({ id: session.id, startsAt, capacity: PROD_SESSION_CAPACITY, classTypeId: entry.classTypeId, inBookingWindow: true });
        }
      }
    }
  }

  console.info(`[seed:prod] Sessions generated: ${totalSessionsGenerated} total, ${bookableSessions.length} in ${PROD_BOOKING_DAYS}-day booking window.`);

  // Entitlements: first 50 clients get a 10-pack; next 50 get monthly subscription
  const purchasedAt = addDaysUtc(seedDayUtc, -3);
  type ProdEntitlementState = { id: string; orderId: string; priceId: string; unlimitedAccess: boolean; creditsRemaining: number; activatedAt: Date; expiresAt: Date | null };
  const entitlementByClientId = new Map<string, ProdEntitlementState>();

  const tenPackEntitlementRule = await prisma.entitlementRule.findFirst({ where: { productId: input.collectiveTenPackProductId, isActive: true, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES } });
  if (!tenPackEntitlementRule) throw new Error("[seed:prod] 10-pack entitlement rule not found.");
  const monthlyEntitlementRule = await prisma.entitlementRule.findFirst({ where: { productId: input.collectiveMonthlyProductId, isActive: true, entitlementScope: EntitlementScope.COLLECTIVE_CLASSES } });
  if (!monthlyEntitlementRule) throw new Error("[seed:prod] Monthly entitlement rule not found.");

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
      entitlementByClientId.set(client.id, {
        id: existing.id,
        orderId: existing.orderId!,
        priceId,
        unlimitedAccess: isMonthly,
        creditsRemaining: isMonthly ? Infinity : 10,
        activatedAt: existing.activatedAt ?? purchasedAt,
        expiresAt: existing.expiresAt,
      });
      continue;
    }

    const productNameSnapshot = isMonthly ? "Monthly Recurrent Collective Subscription" : "10-Ticket Collective Classes";
    const priceNameSnapshot = isMonthly ? "Monthly Unlimited Collective - Monthly" : "10-Class Pack - One Time";
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

  console.info(`[seed:prod] Entitlements seeded: 50 clients with 10-pack, 50 clients with monthly subscription.`);

  // Pre-populate bookings for sessions within booking window (~40% occupancy)
  const bookedPairs = new Set<string>();
  let bookingsCreated = 0;
  let clientIndex = 0;
  const bookingWindowSessions = bookableSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  for (const session of bookingWindowSessions) {
    const daysAhead = Math.floor((session.startsAt.getTime() - seedDayUtc.getTime()) / (1000 * 60 * 60 * 24));
    // Near-term sessions: ~50% occupancy; further sessions: ~25%
    const targetOccupancy = daysAhead <= 30 ? rng.int(5, 9) : rng.int(2, 5);
    let createdForSession = 0;
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
        data: { clientId: client.id, studioSessionId: session.id, orderId: entitlement.orderId, status: BookingStatus.CONFIRMED, bookingIntent: BookingIntent.USE_PLAN, paymentSelection: BookingPaymentSelection.EXISTING_PLAN, selectedEntitlementId: entitlement.id, selectedPriceId: entitlement.priceId, bookedAt, customerName: client.name, customerEmail: client.email, consentTermsAccepted: true, consentPrivacyAccepted: true, consentAcceptedAt: bookedAt, cancellationEligibleUntilAt, cancelledAt: null, creditRefundedAt: null },
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

  console.info(`[seed:prod] Bookings created: ${bookingsCreated} across ${bookingWindowSessions.length} sessions in booking window.`);
  return { totalSessionsGenerated, bookableSessionCount: bookableSessions.length, bookingsCreated };
}

// ─── Learning ─────────────────────────────────────────────────────────────────

async function seedProductionLearning() {
  // Validate image paths at seed time (assertLearningImagePath validates format, not disk)
  assertLearningImagePath(toCanonicalSeedImagePath(PROD_LEARNING_IMAGE_FITNESS), "prod fitness image");
  assertLearningImagePath(toCanonicalSeedImagePath(PROD_LEARNING_IMAGE_YOGA), "prod yoga image");
  assertLearningImagePath(toCanonicalSeedImagePath(PROD_LEARNING_IMAGE_PILATES), "prod pilates image");

  const programs = [FITNESS_PROGRAM, YOGA_PROGRAM, PILATES_PROGRAM];
  const allCourses = [...FITNESS_COURSES, ...YOGA_COURSES, ...PILATES_COURSES];

  for (const program of programs) {
    await prisma.learningProgram.upsert({
      where: { legacyId: program.legacyId },
      update: { mainTitle: program.mainTitle, mainDescription: program.mainDescription, courseType: program.courseType, title: program.title, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 },
      create: { legacyId: program.legacyId, mainTitle: program.mainTitle, mainDescription: program.mainDescription, courseType: program.courseType, title: program.title, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 },
    });
  }

  for (const course of allCourses) {
    await prisma.learningCourse.upsert({
      where: { legacyId: course.legacyId },
      update: { title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority },
      create: { legacyId: course.legacyId, title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority },
    });
  }

  console.info(`[seed:prod] Learning seeded: ${programs.length} programmes, ${allCourses.length} courses.`);
  return { programCount: programs.length, courseCount: allCourses.length };
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
  console.info(`[seed:prod] Agenda schedule seeded: ${AGENDA_SCHEDULE.length} entries.`);
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
    update: { name: "BookMyClass is live!", status: MarketingCampaignStatus.SENT, categoryId: launchCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "BookMyClass is now live — book your first class", previewText: "Reserve your spot in our opening schedule.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.app", replyTo: "support@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "We're live!" }, { type: "paragraph", text: "Your membership is ready. Book your first class today." }, { type: "button", text: "View schedule", url: "https://bookmyclass.app/book-a-class" }] }, htmlSnapshot: "<html><body><h2>We're live!</h2><p>Your membership is ready. Book your first class today.</p></body></html>", sentAt: launchSentAt, createdById: input.createdById },
    create: { id: "prod-seed-marketing-launch", name: "BookMyClass is live!", status: MarketingCampaignStatus.SENT, categoryId: launchCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "BookMyClass is now live — book your first class", previewText: "Reserve your spot in our opening schedule.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.app", replyTo: "support@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "We're live!" }, { type: "paragraph", text: "Your membership is ready. Book your first class today." }, { type: "button", text: "View schedule", url: "https://bookmyclass.app/book-a-class" }] }, htmlSnapshot: "<html><body><h2>We're live!</h2><p>Your membership is ready. Book your first class today.</p></body></html>", sentAt: launchSentAt, createdById: input.createdById },
  });

  const sampleRecipients = [
    { id: "prod-seed-mkt-rec-01", email: "client-001@test.user", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:18.000Z"), openedAt: new Date("2026-04-01T10:15:00.000Z"), clickedAt: new Date("2026-04-01T10:17:00.000Z") },
    { id: "prod-seed-mkt-rec-02", email: "client-002@test.user", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:20.000Z"), openedAt: null, clickedAt: null },
    { id: "prod-seed-mkt-rec-03", email: "client-003@test.user", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:22.000Z"), openedAt: new Date("2026-04-01T11:00:00.000Z"), clickedAt: null },
    { id: "prod-seed-mkt-rec-04", email: "client-004@test.user", status: MarketingRecipientStatus.BOUNCED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: null, openedAt: null, clickedAt: null },
    { id: "prod-seed-mkt-rec-05", email: "client-005@test.user", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-04-01T10:01:00.000Z"), deliveredAt: new Date("2026-04-01T10:01:25.000Z"), openedAt: new Date("2026-04-01T14:20:00.000Z"), clickedAt: new Date("2026-04-01T14:22:00.000Z") },
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
    update: { name: "May Studio Newsletter", status: MarketingCampaignStatus.DRAFT, categoryId: newsCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "What's new at BookMyClass this month", previewText: "New classes, instructor spotlights, and member milestones.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.app", replyTo: "support@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "May Studio Update" }, { type: "paragraph", text: "Here is what's happening in the studio this month." }] }, htmlSnapshot: null, sentAt: null, createdById: input.createdById },
    create: { id: "prod-seed-marketing-newsletter-draft", name: "May Studio Newsletter", status: MarketingCampaignStatus.DRAFT, categoryId: newsCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "What's new at BookMyClass this month", previewText: "New classes, instructor spotlights, and member milestones.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.app", replyTo: "support@bookmyclass.app", contentJson: { blocks: [{ type: "heading", text: "May Studio Update" }, { type: "paragraph", text: "Here is what's happening in the studio this month." }] }, createdById: input.createdById },
  });

  console.info("[seed:prod] Marketing history seeded (1 sent campaign, 5 recipients, 1 draft).");
}

// ─── Verification ─────────────────────────────────────────────────────────────

async function verifyProductionSeed(expected: { programCount: number; courseCount: number; totalSessionsGenerated: number; bookableSessionCount: number; bookingsCreated: number }) {
  const [totalClients, totalAdmins, totalTeachers, totalProducts, programCount, courseCount, scheduleCount] = await prisma.$transaction([
    prisma.user.count({ where: { role: Role.CLIENT, email: { endsWith: "@test.user" } } }),
    prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] }, email: { endsWith: "@bookmyclass.app" } } }),
    prisma.user.count({ where: { role: Role.TEACHER, email: { endsWith: "@bookmyclass.app" } } }),
    prisma.product.count({ where: { isActive: true, isArchived: false } }),
    prisma.learningProgram.count(),
    prisma.learningCourse.count(),
    prisma.siteWeeklyScheduleEntry.count({ where: { isActive: true } }),
  ]);

  if (totalClients < PROD_CLIENT_COUNT) throw new Error(`Production seed verification: expected at least ${PROD_CLIENT_COUNT} @test.user clients, got ${totalClients}.`);
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

  console.info(`[seed:prod] Verification passed. clients=${totalClients}, admins=${totalAdmins}, teachers=${totalTeachers}, products=${totalProducts}, programmes=${programCount}, courses=${courseCount}, sessions=${expected.totalSessionsGenerated}, bookableSessions=${expected.bookableSessionCount}, bookings=${expected.bookingsCreated}, scheduleEntries=${scheduleCount}.`);
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

export async function runProductionSeed(): Promise<void> {
  console.info("[seed:prod] Starting production seed (mode: production — upsert-only, no purge).");
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  const { masterAdmin: _master, admin, teachers, clients } = await seedProductionUsers();
  await seedBookingPolicy();
  const { collectiveTenPack, collectiveMonthly } = await seedProductionCatalog(stripePriceIdByLookupKey);
  await seedProductionStoreCatalog(stripePriceIdByLookupKey);

  // Resolve price and entitlement rule IDs needed for booking seeding
  const tenPackPrice = await prisma.price.findUnique({ where: { lookupKey: "collective-10-pack-eur-once-v1" } });
  if (!tenPackPrice) throw new Error("[seed:prod] 10-pack price not persisted — catalog seed must run first.");
  const monthlyPrice = await prisma.price.findUnique({ where: { lookupKey: "monthly-unlimited-collective-eur-monthly-v1" } });
  if (!monthlyPrice) throw new Error("[seed:prod] Monthly price not persisted — catalog seed must run first.");

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
    `[seed:prod] Seed media sync: copied=${mediaSyncSummary.copiedCount}, existing=${mediaSyncSummary.existingCount}.`,
  );
  const seededMediaPathCount = await verifySeededMediaReferences(prisma);
  console.info(`[seed:prod] Seeded media verified: ${seededMediaPathCount} canonical /uploads paths.`);
  await verifyProductionSeed({ ...learningSummary, ...schedulingSummary });

  console.info(`[seed:prod] Completed: clients=${PROD_CLIENT_COUNT}, sessions=${schedulingSummary.totalSessionsGenerated}, bookings=${schedulingSummary.bookingsCreated}, programmes=${learningSummary.programCount}, courses=${learningSummary.courseCount}.`);
}
