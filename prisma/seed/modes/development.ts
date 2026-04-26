/**
 * Development seed mode — used for both DEV and UAT environments.
 * Output is identical regardless of environment when run with BOOKMYCLASS_SEED_MODE=development.
 *
 * Includes: users, catalog, scheduling (120-day past + 14-day future),
 *           learning content (from JSON), agenda schedule, marketing demo data.
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
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../../../src/lib/db";
import { assertLearningImagePath } from "../../../src/lib/learning/image-paths";
import { AGENDA_SCHEDULE } from "../data/schedule";
import { createSeededRng } from "../utils/deterministic-random";

// ─── Constants ──────────────────────────────────────────────────────────────

const SEED_CLIENT_COUNT = 150;
const SEED_PAST_DAYS = 120;
const SEED_FUTURE_DAYS = 14;
const SEED_RANDOM_SEED = 20260418;

const HEAVY_CLIENT_RATIO = 0.2;
const MODERATE_CLIENT_RATIO = 0.35;
const LIGHT_CLIENT_RATIO = 0.25;
const RETURNING_CLIENT_RATIO = 0.1;

const FUTURE_OCCUPANCY_LOW_RATIO = 0.5;
const FUTURE_OCCUPANCY_MEDIUM_RATIO = 0.3;
const FUTURE_OCCUPANCY_HIGH_RATIO = 0.14;
const FUTURE_OCCUPANCY_NEAR_FULL_RATIO = 0.05;

const COLLECTIVE_SESSION_CAPACITY = 15;

const seedDayUtc = new Date();
seedDayUtc.setUTCHours(0, 0, 0, 0);
const pastWindowStartUtc = new Date(seedDayUtc);
pastWindowStartUtc.setUTCDate(pastWindowStartUtc.getUTCDate() - SEED_PAST_DAYS);
pastWindowStartUtc.setUTCHours(0, 0, 0, 0);
const pastWindowEndUtc = new Date(seedDayUtc);
pastWindowEndUtc.setUTCDate(pastWindowEndUtc.getUTCDate() - 1);
pastWindowEndUtc.setUTCHours(23, 59, 59, 999);
const futureWindowStartUtc = new Date(seedDayUtc);
futureWindowStartUtc.setUTCDate(futureWindowStartUtc.getUTCDate() + 1);
futureWindowStartUtc.setUTCHours(0, 0, 0, 0);
const futureWindowEndUtc = new Date(seedDayUtc);
futureWindowEndUtc.setUTCDate(futureWindowEndUtc.getUTCDate() + SEED_FUTURE_DAYS);
futureWindowEndUtc.setUTCHours(23, 59, 59, 999);

const SCHEDULE_BLACKOUT_DATES = new Set<string>();
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;
const COUNTED_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.NO_SHOW,
];

type CatalogStripePriceEnvSpec = { productName: string; lookupKey: string; envVarName: string };

const PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS: CatalogStripePriceEnvSpec[] = [
  { productName: "Collective Class Drop-In", lookupKey: "collective-drop-in-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_DROP_IN" },
  { productName: "5-Ticket Collective Classes", lookupKey: "qa-collective-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_5_PACK" },
  { productName: "10-Ticket Collective Classes", lookupKey: "collective-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_COLLECTIVE_10_PACK" },
  { productName: "Monthly Recurrent Collective Subscription", lookupKey: "monthly-unlimited-collective-eur-monthly-v1", envVarName: "STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE" },
  { productName: "5-Ticket Private Classes", lookupKey: "qa-private-5-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_5_PACK" },
  { productName: "10-Ticket Private Classes", lookupKey: "qa-private-10-pack-eur-once-v1", envVarName: "STRIPE_PRICE_ID_PRIVATE_10_PACK" },
];

const DEFAULT_LEARNING_SEED_JSON_PATH = resolve(process.cwd(), "prisma", "seed-data", "learning-content.json");

// ─── Types ───────────────────────────────────────────────────────────────────

type LearningProgramSeedInput = {
  legacyId: string; mainTitle: string; mainDescription?: string; courseType: string;
  title: string; description1?: string; description2?: string; description3?: string;
  videoPromo?: string; picture1?: string; picture2?: string; picture3?: string;
};

type LearningCourseSeedInput = {
  legacyId: string; title: string; description?: string; shortDescription?: string;
  category: string; categoryType?: string; categoryLevel?: string;
  thumbnail?: string; videoUrl?: string; priority: number;
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRequiredString(value: unknown): string | undefined {
  return asOptionalString(value);
}

function asRequiredId(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickFirstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function slugifyForLegacyId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "uncategorized";
}

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

function startOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function endOfUtcDay(value: Date): Date {
  const date = new Date(value);
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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

function nextOccurrencesInWindow(params: {
  weekday: Weekday; time: string; windowStart: Date; windowEnd: Date; extraSkipDates?: string[];
}): Date[] {
  const { weekday, time, windowStart, windowEnd, extraSkipDates = [] } = params;
  const jsDay = weekdayToJsDay(weekday);
  const { hour, minute } = parseTime(time);
  const skipDates = new Set([...SCHEDULE_BLACKOUT_DATES, ...extraSkipDates]);
  const result: Date[] = [];
  const cursor = new Date(windowStart);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor <= windowEnd) {
    const candidate = new Date(cursor);
    if (candidate.getUTCDay() !== jsDay) { cursor.setUTCDate(cursor.getUTCDate() + 1); continue; }
    const startsAt = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), hour, minute, 0, 0));
    if (startsAt < windowStart || startsAt > windowEnd || skipDates.has(dateKey(startsAt))) { cursor.setUTCDate(cursor.getUTCDate() + 1); continue; }
    result.push(startsAt);
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
    throw new Error(`Seed validation failed for purchasable catalog Stripe price configuration.\n${details}`);
  }

  console.info("[seed:dev] Stripe price configuration validated.");
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
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function seedUsers() {
  const rng = createSeededRng(SEED_RANDOM_SEED + 11);
  const sharedPasswordHash = await hash("qwerty123456", 12);
  const sharedEmailVerifiedAt = new Date("2026-01-01T00:00:00.000Z");

  const masterAdmin = await prisma.user.create({
    data: {
      name: "Master Admin", firstName: "Master", lastName: "Admin",
      email: "masteradmin@yogapilatesfitness.local",
      role: Role.MASTER_ADMIN, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-20T08:00:00.000Z"),
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: "Admin User", firstName: "Admin", lastName: "User",
      email: "admin@yogapilatesfitness.local",
      role: Role.ADMIN, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-19T11:00:00.000Z"),
    },
  });

  const ana = await prisma.user.create({
    data: {
      name: "Ana Ionescu", firstName: "Ana", lastName: "Ionescu",
      email: "ana.ionescu@yogapilatesfitness.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/ana_instructor_bio.jpg",
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
      email: "elena.moreau@yogapilatesfitness.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/elena_instructor_bio.jpg",
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
      email: "sofia.vandenberg@yogapilatesfitness.local",
      role: Role.TEACHER, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/sofia_instructor_bio.jpg",
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

  const client = await prisma.user.create({
    data: {
      name: "Client User", firstName: "Client", lastName: "User",
      email: "client@yogapilatesfitness.local",
      role: Role.CLIENT, passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt, emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true, isInactive: false, lastLoginAt: new Date("2026-03-10T18:45:00.000Z"),
      clientProfile: { create: { phone: "+32000000002", notes: "Clean QA client account." } },
    },
  });

  const firstNames = ["Lucas","Emma","Noah","Olivia","Liam","Mila","Ethan","Sofia","Ava","Mason","Ella","Lena","Leo","Chloe","Nora","Aiden","Aria","Zoe","Mia","Luca","Amelia","Theo","Camille","Jules","Nina","Ines","Amir","Hana","Mateo","Lea","Sam","Marta","Yara","Elise","Maya","Iris","Dalia","Anouk","Lina","Sarah"] as const;
  const lastNames = ["De Smet","Peeters","Dubois","Martin","Lefevre","Dupont","Lambert","Moreau","Leroy","Legrand","Simon","Michel","Garcia","Bernard","Van den Broeck","Vermeulen","Rousseau","Masson","Bakker","Jacobs","Remy","Charpentier","Dumont","Vidal","Perez","Kowalski","Novak","Fernandez","Costa","Meyer"] as const;

  const slugifyNamePart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  const candidateNames: Array<{ firstName: string; lastName: string }> = [];
  for (const firstName of firstNames) {
    for (const lastName of lastNames) { candidateNames.push({ firstName, lastName }); }
  }

  const extraClientsNeeded = SEED_CLIENT_COUNT - 1;
  if (candidateNames.length < extraClientsNeeded) {
    throw new Error("Insufficient deterministic name pool for requested client seed count.");
  }

  const selectedCandidates = rng.shuffle(candidateNames).slice(0, extraClientsNeeded);
  for (let index = 0; index < selectedCandidates.length; index += 1) {
    const candidate = selectedCandidates[index]!;
    const fullName = `${candidate.firstName} ${candidate.lastName}`;
    const email = `${slugifyNamePart(candidate.firstName)}.${slugifyNamePart(candidate.lastName)}.${String(index + 1).padStart(3, "0")}@yogapilatesfitness.local`;
    const verifiedAt = new Date(sharedEmailVerifiedAt);
    verifiedAt.setUTCDate(verifiedAt.getUTCDate() + (index % 30));
    const lastLoginAt = new Date(seedDayUtc);
    lastLoginAt.setUTCDate(lastLoginAt.getUTCDate() - rng.int(0, 45));
    lastLoginAt.setUTCHours(rng.int(7, 21), rng.int(0, 59), 0, 0);

    await prisma.user.create({
      data: {
        name: fullName, firstName: candidate.firstName, lastName: candidate.lastName, email,
        role: Role.CLIENT, passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt, emailVerifiedAt: verifiedAt,
        isActive: true, isInactive: false, lastLoginAt,
        clientProfile: { create: { phone: `+3201${String(index + 1).padStart(8, "0")}`, notes: "Seeded deterministic demo client profile." } },
      },
    });
  }

  return { masterAdmin, admin, teachers: { ana, elena, sofia }, client };
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

async function assertPurchasableCatalogStripePriceIdsPersisted() {
  const seededPrices = await prisma.price.findMany({
    where: { lookupKey: { in: PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS.map((s) => s.lookupKey) } },
    select: { lookupKey: true, stripePriceId: true, stripeSyncStatus: true },
  });
  const missingStripeIds = seededPrices.filter((p) => !p.stripePriceId).map((p) => p.lookupKey);
  if (missingStripeIds.length > 0) throw new Error(`Seed verification failed: Stripe price IDs missing for: ${missingStripeIds.join(", ")}`);
  const seededLookupKeys = new Set(seededPrices.map((p) => p.lookupKey));
  const missingRows = PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS.map((s) => s.lookupKey).filter((k) => !seededLookupKeys.has(k));
  if (missingRows.length > 0) throw new Error(`Seed verification failed: missing catalog prices for: ${missingRows.join(", ")}`);
  const nonSyncedRows = seededPrices.filter((p) => p.stripeSyncStatus !== StripeSyncStatus.SYNCED).map((p) => `${p.lookupKey}:${p.stripeSyncStatus}`);
  if (nonSyncedRows.length > 0) throw new Error(`Seed verification failed: non-SYNCED prices: ${nonSyncedRows.join(", ")}`);
  console.info(`[seed:dev] Verified ${seededPrices.length} Stripe-linked catalog prices.`);
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

  await assertPurchasableCatalogStripePriceIdsPersisted();
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

async function upsertStudioSession(input: { classTemplateId: string; recurringRuleId?: string; classTypeId: string; teacherId: string; title: string; description?: string; location?: string; startsAt: Date; endsAt: Date; capacity: number }) {
  return prisma.studioSession.upsert({
    where: { classTemplateId_startsAt: { classTemplateId: input.classTemplateId, startsAt: input.startsAt } },
    update: { recurringRuleId: input.recurringRuleId, classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, cancelledAt: null, cancelledReason: null, cancelledById: null, isPublished: true },
    create: { classTemplateId: input.classTemplateId, recurringRuleId: input.recurringRuleId, classTypeId: input.classTypeId, teacherId: input.teacherId, title: input.title, description: input.description, location: input.location, startsAt: input.startsAt, endsAt: input.endsAt, capacity: input.capacity, status: StudioSessionStatus.SCHEDULED, isPublished: true },
  });
}

// ─── Marketing demo data ──────────────────────────────────────────────────────

async function seedMarketingDemoData(input: { createdById: string }) {
  const announcementCategory = await prisma.marketingCategory.upsert({
    where: { slug: "announcement" }, update: { name: "Announcement", isActive: true },
    create: { name: "Announcement", slug: "announcement", isActive: true },
  });
  const promotionCategory = await prisma.marketingCategory.upsert({
    where: { slug: "promotion" }, update: { name: "Promotion", isActive: true },
    create: { name: "Promotion", slug: "promotion", isActive: true },
  });
  await prisma.marketingCategory.upsert({
    where: { slug: "newsletter" }, update: { name: "Newsletter", isActive: true },
    create: { name: "Newsletter", slug: "newsletter", isActive: true },
  });

  const draftCampaign = await prisma.marketingCampaign.upsert({
    where: { id: "seed-marketing-draft-campaign" },
    update: { name: "Beta Welcome Announcement Draft", status: MarketingCampaignStatus.DRAFT, categoryId: announcementCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Welcome to our beta studio updates", previewText: "A quick look at what members can expect this month.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.local", replyTo: "support@bookmyclass.local", contentJson: { blocks: [{ type: "heading", text: "Welcome to BookMyClass Beta" }, { type: "paragraph", text: "Thanks for joining us." }, { type: "button", text: "View classes", url: "https://bookmyclass.local/book-a-class" }] }, htmlSnapshot: null, sentAt: null, createdById: input.createdById },
    create: { id: "seed-marketing-draft-campaign", name: "Beta Welcome Announcement Draft", status: MarketingCampaignStatus.DRAFT, categoryId: announcementCategory.id, audienceType: MarketingAudienceType.ALL_USERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Welcome to our beta studio updates", previewText: "A quick look at what members can expect this month.", fromName: "BookMyClass Studio", fromEmail: "hello@bookmyclass.local", replyTo: "support@bookmyclass.local", contentJson: { blocks: [{ type: "heading", text: "Welcome to BookMyClass Beta" }, { type: "paragraph", text: "Thanks for joining us." }, { type: "button", text: "View classes", url: "https://bookmyclass.local/book-a-class" }] }, createdById: input.createdById },
  });

  const sentCampaignSentAt = new Date("2026-03-25T10:00:00.000Z");
  const sentCampaign = await prisma.marketingCampaign.upsert({
    where: { id: "seed-marketing-sent-campaign" },
    update: { name: "Spring Studio Promotion", status: MarketingCampaignStatus.SENT, categoryId: promotionCategory.id, audienceType: MarketingAudienceType.PAYING_SUBSCRIBERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Spring promo: extra classes this week", previewText: "Members get bonus class access while spots last.", fromName: "BookMyClass Studio", fromEmail: "offers@bookmyclass.local", replyTo: "support@bookmyclass.local", contentJson: { blocks: [{ type: "heading", text: "Spring Promo Is Live" }, { type: "paragraph", text: "Book this week's classes early." }] }, htmlSnapshot: "<html><body><h2>Spring Promo Is Live</h2></body></html>", sentAt: sentCampaignSentAt, createdById: input.createdById },
    create: { id: "seed-marketing-sent-campaign", name: "Spring Studio Promotion", status: MarketingCampaignStatus.SENT, categoryId: promotionCategory.id, audienceType: MarketingAudienceType.PAYING_SUBSCRIBERS, manualAudienceJson: { emails: [], userIds: [] }, subject: "Spring promo: extra classes this week", previewText: "Members get bonus class access while spots last.", fromName: "BookMyClass Studio", fromEmail: "offers@bookmyclass.local", replyTo: "support@bookmyclass.local", contentJson: { blocks: [{ type: "heading", text: "Spring Promo Is Live" }, { type: "paragraph", text: "Book this week's classes early." }] }, htmlSnapshot: "<html><body><h2>Spring Promo Is Live</h2></body></html>", sentAt: sentCampaignSentAt, createdById: input.createdById },
  });

  const recipientFixtures = [
    { id: "seed-mkt-recipient-01", email: "alice.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:01:00.000Z"), deliveredAt: new Date("2026-03-25T10:01:20.000Z"), openedAt: new Date("2026-03-25T10:10:00.000Z"), clickedAt: new Date("2026-03-25T10:12:00.000Z"), unsubscribedAt: null },
    { id: "seed-mkt-recipient-02", email: "beatrice.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.SENT, sentAt: new Date("2026-03-25T10:02:00.000Z"), deliveredAt: null, openedAt: null, clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-03", email: "celine.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:03:00.000Z"), deliveredAt: new Date("2026-03-25T10:03:10.000Z"), openedAt: new Date("2026-03-25T10:14:00.000Z"), clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-04", email: "diana.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.BOUNCED, sentAt: new Date("2026-03-25T10:04:00.000Z"), deliveredAt: null, openedAt: null, clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-05", email: "eva.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:05:00.000Z"), deliveredAt: new Date("2026-03-25T10:05:12.000Z"), openedAt: new Date("2026-03-25T10:20:00.000Z"), clickedAt: new Date("2026-03-25T10:24:00.000Z"), unsubscribedAt: null },
    { id: "seed-mkt-recipient-06", email: "fatima.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.FAILED, sentAt: null, deliveredAt: null, openedAt: null, clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-07", email: "grace.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:06:00.000Z"), deliveredAt: new Date("2026-03-25T10:06:14.000Z"), openedAt: null, clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-08", email: "hana.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.SENT, sentAt: new Date("2026-03-25T10:07:00.000Z"), deliveredAt: null, openedAt: null, clickedAt: null, unsubscribedAt: null },
    { id: "seed-mkt-recipient-09", email: "ines.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:08:00.000Z"), deliveredAt: new Date("2026-03-25T10:08:16.000Z"), openedAt: new Date("2026-03-25T10:18:00.000Z"), clickedAt: new Date("2026-03-25T10:31:00.000Z"), unsubscribedAt: new Date("2026-03-25T10:40:00.000Z") },
    { id: "seed-mkt-recipient-10", email: "jade.seed+marketing@bookmyclass.local", status: MarketingRecipientStatus.DELIVERED, sentAt: new Date("2026-03-25T10:09:00.000Z"), deliveredAt: new Date("2026-03-25T10:09:14.000Z"), openedAt: null, clickedAt: null, unsubscribedAt: null },
  ];

  for (const recipient of recipientFixtures) {
    await prisma.marketingCampaignRecipient.upsert({
      where: { id: recipient.id },
      update: { campaignId: sentCampaign.id, userId: null, email: recipient.email, status: recipient.status, sentAt: recipient.sentAt, deliveredAt: recipient.deliveredAt, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, unsubscribedAt: recipient.unsubscribedAt },
      create: { id: recipient.id, campaignId: sentCampaign.id, userId: null, email: recipient.email, status: recipient.status, sentAt: recipient.sentAt, deliveredAt: recipient.deliveredAt, openedAt: recipient.openedAt, clickedAt: recipient.clickedAt, unsubscribedAt: recipient.unsubscribedAt },
    });
  }

  const firstLink = await prisma.marketingCampaignLink.upsert({
    where: { token: "seed-mkt-link-bookings" },
    update: { campaignId: sentCampaign.id, url: "https://bookmyclass.local/dashboard/bookings", clickCount: 0 },
    create: { campaignId: sentCampaign.id, url: "https://bookmyclass.local/dashboard/bookings", token: "seed-mkt-link-bookings", clickCount: 0 },
  });
  const secondLink = await prisma.marketingCampaignLink.upsert({
    where: { token: "seed-mkt-link-subscription" },
    update: { campaignId: sentCampaign.id, url: "https://bookmyclass.local/subscription", clickCount: 0 },
    create: { campaignId: sentCampaign.id, url: "https://bookmyclass.local/subscription", token: "seed-mkt-link-subscription", clickCount: 0 },
  });

  const clickFixtures = [
    { id: "seed-mkt-click-01", linkId: firstLink.id, recipientId: "seed-mkt-recipient-01", clickedAt: new Date("2026-03-25T10:12:00.000Z") },
    { id: "seed-mkt-click-02", linkId: firstLink.id, recipientId: "seed-mkt-recipient-05", clickedAt: new Date("2026-03-25T10:24:00.000Z") },
    { id: "seed-mkt-click-03", linkId: secondLink.id, recipientId: "seed-mkt-recipient-09", clickedAt: new Date("2026-03-25T10:31:00.000Z") },
    { id: "seed-mkt-click-04", linkId: secondLink.id, recipientId: "seed-mkt-recipient-01", clickedAt: new Date("2026-03-25T10:33:00.000Z") },
  ];
  for (const click of clickFixtures) {
    await prisma.marketingCampaignLinkClick.upsert({
      where: { id: click.id },
      update: { campaignLinkId: click.linkId, recipientId: click.recipientId, clickedAt: click.clickedAt, ip: "127.0.0.1", userAgent: "seed-agent" },
      create: { id: click.id, campaignLinkId: click.linkId, recipientId: click.recipientId, clickedAt: click.clickedAt, ip: "127.0.0.1", userAgent: "seed-agent" },
    });
  }

  const firstLinkClickCount = await prisma.marketingCampaignLinkClick.count({ where: { campaignLinkId: firstLink.id } });
  const secondLinkClickCount = await prisma.marketingCampaignLinkClick.count({ where: { campaignLinkId: secondLink.id } });
  await prisma.marketingCampaignLink.update({ where: { id: firstLink.id }, data: { clickCount: firstLinkClickCount } });
  await prisma.marketingCampaignLink.update({ where: { id: secondLink.id }, data: { clickCount: secondLinkClickCount } });

  await prisma.marketingUnsubscribe.upsert({
    where: { email: "ines.seed+marketing@bookmyclass.local" },
    update: { userId: null, unsubscribedAt: new Date("2026-03-25T10:40:00.000Z") },
    create: { email: "ines.seed+marketing@bookmyclass.local", userId: null, unsubscribedAt: new Date("2026-03-25T10:40:00.000Z") },
  });

  console.info(`[seed:dev] Marketing demo data ready (draft=${draftCampaign.id}, sent=${sentCampaign.id}).`);
}

// ─── Agenda schedule ──────────────────────────────────────────────────────────

async function seedAgendaSchedule() {
  for (let index = 0; index < AGENDA_SCHEDULE.length; index += 1) {
    const entry = AGENDA_SCHEDULE[index]!;
    await prisma.siteWeeklyScheduleEntry.upsert({
      where: {
        id: `seed-schedule-${entry.dayOfWeek}-${index}`,
      },
      update: {
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        label: entry.label,
        displayOrder: entry.displayOrder,
        isActive: true,
      },
      create: {
        id: `seed-schedule-${entry.dayOfWeek}-${index}`,
        dayOfWeek: entry.dayOfWeek,
        startTime: entry.startTime,
        endTime: entry.endTime,
        label: entry.label,
        displayOrder: entry.displayOrder,
        isActive: true,
      },
    });
  }
  console.info(`[seed:dev] Agenda schedule seeded: ${AGENDA_SCHEDULE.length} entries.`);
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

async function seedScheduling(teachers: { anaId: string; elenaId: string; sofiaId: string }) {
  const rng = createSeededRng(SEED_RANDOM_SEED + 97);

  type UsageTier = "HEAVY" | "MODERATE" | "LIGHT" | "RETURNING" | "INACTIVE";
  type OwnershipState = "NO_PURCHASE" | "EXPIRED_ONLY" | "ACTIVE_DROP_IN" | "ACTIVE_5_PACK" | "ACTIVE_10_PACK" | "ACTIVE_MONTHLY" | "PRIVATE_ONLY";
  type CollectiveSessionSeed = { id: string; startsAt: Date; capacity: number; classTypeId: string; isFuture: boolean; occupancyTarget: number };
  type SeedEntitlementState = { id: string; orderId: string; priceId: string; clientId: string; entitlementScope: EntitlementScope; activatedAt: Date; expiresAt: Date | null; unlimitedAccess: boolean; creditsRemaining: number };
  type PurchaseLookupKey = "collective-drop-in-eur-once-v1" | "qa-collective-5-pack-eur-once-v1" | "collective-10-pack-eur-once-v1" | "monthly-unlimited-collective-eur-monthly-v1" | "qa-private-5-pack-eur-once-v1";

  const ownershipCounts: Record<OwnershipState, number> = { NO_PURCHASE: 24, EXPIRED_ONLY: 24, ACTIVE_DROP_IN: 15, ACTIVE_5_PACK: 27, ACTIVE_10_PACK: 24, ACTIVE_MONTHLY: 30, PRIVATE_ONLY: 6 };
  const usageRatios: Record<UsageTier, number> = { HEAVY: HEAVY_CLIENT_RATIO, MODERATE: MODERATE_CLIENT_RATIO, LIGHT: LIGHT_CLIENT_RATIO, RETURNING: RETURNING_CLIENT_RATIO, INACTIVE: 1 - HEAVY_CLIENT_RATIO - MODERATE_CLIENT_RATIO - LIGHT_CLIENT_RATIO - RETURNING_CLIENT_RATIO };

  const yogaCategory = await upsertClassCategory({ slug: "yoga-collective-classes", name: "Yoga Collective Classes", description: "Dynamic and restorative yoga classes for collective groups.", sortOrder: 10 });
  const pilatesCategory = await upsertClassCategory({ slug: "pilates-collective-classes", name: "Pilates Collective Classes", description: "Mat and reformer-inspired pilates sessions in small groups.", sortOrder: 20 });
  const fitnessCategory = await upsertClassCategory({ slug: "fitness-functional", name: "Fitness & Functional", description: "Strength, mobility, and conditioning sessions.", sortOrder: 30 });
  const privateCategory = await upsertClassCategory({ slug: "private-reformer-coach", name: "Private Reformer Coach", description: "Private reformer coaching and technique refinement.", sortOrder: 40 });

  const vinyasaYoga = await upsertClassType({ slug: "vinyasa-yoga", categoryId: yogaCategory.id, name: "Vinyasa Yoga", description: "Breath-led flowing yoga for strength and mobility.", imageUrl: "/images/classes/vinyasa-yoga.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const rocketYoga = await upsertClassType({ slug: "rocket-yoga", categoryId: yogaCategory.id, name: "Rocket Yoga", description: "High-energy yoga sequencing with progressive options.", imageUrl: "/images/classes/rocket-yoga.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const hathaYoga = await upsertClassType({ slug: "hatha-yoga", categoryId: yogaCategory.id, name: "Hatha Yoga", description: "Slower paced foundational yoga and alignment practice.", imageUrl: "/images/classes/hatha-yoga.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 30 });
  const matPilates = await upsertClassType({ slug: "mat-pilates", categoryId: pilatesCategory.id, name: "Mat Pilates", description: "Core-driven pilates session suitable for all levels.", imageUrl: "/images/classes/mat-pilates.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const reformerFoundations = await upsertClassType({ slug: "reformer-foundations", categoryId: pilatesCategory.id, name: "Reformer Foundations", description: "Small group reformer fundamentals for technique and control.", imageUrl: "/images/classes/reformer-foundations.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 20 });
  const functionalStrength = await upsertClassType({ slug: "functional-strength", categoryId: fitnessCategory.id, name: "Functional Strength", description: "Strength and conditioning with athletic movement patterns.", imageUrl: "/images/classes/functional-strength.jpg", defaultDurationMinutes: 30, defaultCapacity: COLLECTIVE_SESSION_CAPACITY, pricingMode: ServicePricingMode.SINGLE_OR_PLAN, serviceScope: EntitlementScope.COLLECTIVE_CLASSES, sortOrder: 10 });
  const privateReformerCoaching = await upsertClassType({ slug: "private-reformer-coaching", categoryId: privateCategory.id, name: "Private Reformer Coaching", description: "Private 1:1 or duo coaching on the reformer.", imageUrl: "/images/classes/private-reformer-coaching.jpg", defaultDurationMinutes: 30, defaultCapacity: 1, pricingMode: ServicePricingMode.PLAN_ONLY, serviceScope: EntitlementScope.PRIVATE_CLASSES, sortOrder: 10 });

  const vinyasaTemplate = await upsertClassTemplate({ slug: "vinyasa-flow-brussels", classTypeId: vinyasaYoga.id, defaultTeacherId: teachers.anaId, title: "Vinyasa Flow Brussels", description: "A full-spectrum vinyasa class with warm-up, flow and cooldown.", location: "Ixelles Studio A", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const rocketTemplate = await upsertClassTemplate({ slug: "rocket-yoga-power-sequence", classTypeId: rocketYoga.id, defaultTeacherId: teachers.sofiaId, title: "Rocket Yoga Power Sequence", description: "Progressive rocket yoga with core and inversion prep.", location: "Ixelles Studio B", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const hathaTemplate = await upsertClassTemplate({ slug: "hatha-reset-weekend", classTypeId: hathaYoga.id, defaultTeacherId: teachers.anaId, title: "Hatha Reset Weekend", description: "Grounding hatha class focused on breath and posture quality.", location: "Ixelles Studio A", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const matPilatesTemplate = await upsertClassTemplate({ slug: "mat-pilates-core-lab", classTypeId: matPilates.id, defaultTeacherId: teachers.elenaId, title: "Mat Pilates Core Lab", description: "Core and glute-focused mat pilates with progression options.", location: "Etterbeek Studio C", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const reformerTemplate = await upsertClassTemplate({ slug: "reformer-foundations-small-group", classTypeId: reformerFoundations.id, defaultTeacherId: teachers.elenaId, title: "Reformer Foundations Small Group", description: "Technique-first reformer foundations for beginners.", location: "Ixelles Reformer Room", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  const functionalTemplate = await upsertClassTemplate({ slug: "functional-strength-express", classTypeId: functionalStrength.id, defaultTeacherId: teachers.sofiaId, title: "Functional Strength Express", description: "High-focus functional strength class with mobility warm-up.", location: "Etterbeek Performance Room", defaultCapacity: COLLECTIVE_SESSION_CAPACITY, defaultDurationMinutes: 30 });
  await upsertClassTemplate({ slug: "private-reformer-coaching-slot", classTypeId: privateReformerCoaching.id, defaultTeacherId: teachers.anaId, title: "Private Reformer Coaching", description: "Private coaching slot tailored to goals and mobility.", location: "Ixelles Private Studio", defaultCapacity: 1, defaultDurationMinutes: 30 });

  const clients = await prisma.user.findMany({
    where: { role: Role.CLIENT, isActive: true, isInactive: false },
    select: { id: true, name: true, email: true },
    orderBy: { email: "asc" },
  });
  if (clients.length !== SEED_CLIENT_COUNT) {
    throw new Error(`Scheduling seed requires exactly ${SEED_CLIENT_COUNT} active clients, got ${clients.length}.`);
  }

  const collectiveRotation = [
    { template: vinyasaTemplate, classTypeId: vinyasaYoga.id, teacherId: teachers.anaId },
    { template: rocketTemplate, classTypeId: rocketYoga.id, teacherId: teachers.sofiaId },
    { template: hathaTemplate, classTypeId: hathaYoga.id, teacherId: teachers.anaId },
    { template: matPilatesTemplate, classTypeId: matPilates.id, teacherId: teachers.elenaId },
    { template: reformerTemplate, classTypeId: reformerFoundations.id, teacherId: teachers.elenaId },
    { template: functionalTemplate, classTypeId: functionalStrength.id, teacherId: teachers.sofiaId },
  ] as const;

  const collectiveSessions: CollectiveSessionSeed[] = [];
  const pastSessionTimePool = [{ hour: 7, minute: 0 }, { hour: 8, minute: 30 }, { hour: 12, minute: 0 }, { hour: 16, minute: 30 }, { hour: 18, minute: 0 }, { hour: 19, minute: 30 }] as const;
  const pastWeekOffsets = [1, 3, 5] as const;

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
      const session = await upsertStudioSession({ classTemplateId: def.template.id, classTypeId: def.classTypeId, teacherId: def.teacherId, title: def.template.title, description: def.template.description ?? undefined, location: def.template.location ?? undefined, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000), capacity: COLLECTIVE_SESSION_CAPACITY });
      await prisma.studioSession.update({ where: { id: session.id }, data: { status: StudioSessionStatus.COMPLETED } });
      const occupancyScore = rng.next();
      const occupancyTarget = occupancyScore < 0.25 ? rng.int(2, 5) : occupancyScore < 0.75 ? rng.int(6, 11) : rng.int(12, 14);
      collectiveSessions.push({ id: session.id, startsAt, capacity: COLLECTIVE_SESSION_CAPACITY, classTypeId: def.classTypeId, isFuture: false, occupancyTarget });
    }
    weekCursor.setUTCDate(weekCursor.getUTCDate() + 7);
    pastWeekIndex += 1;
  }

  const futureSlotsPerDay = 24;
  const futureSlotStartHour = 8;
  for (let dayOffset = 0; dayOffset < SEED_FUTURE_DAYS; dayOffset += 1) {
    const dayStart = addDaysUtc(futureWindowStartUtc, dayOffset);
    dayStart.setUTCHours(0, 0, 0, 0);
    for (let slotIndex = 0; slotIndex < futureSlotsPerDay; slotIndex += 1) {
      const startsAt = new Date(dayStart);
      startsAt.setUTCHours(futureSlotStartHour + Math.floor(slotIndex / 2), slotIndex % 2 === 0 ? 0 : 30, 0, 0);
      const def = collectiveRotation[(dayOffset * futureSlotsPerDay + slotIndex) % collectiveRotation.length]!;
      const occupancyScore = rng.next();
      let occupancyTarget = 0;
      if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO) { occupancyTarget = rng.int(1, 4); }
      else if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO + FUTURE_OCCUPANCY_MEDIUM_RATIO) { occupancyTarget = rng.int(5, 9); }
      else if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO + FUTURE_OCCUPANCY_MEDIUM_RATIO + FUTURE_OCCUPANCY_HIGH_RATIO) { occupancyTarget = rng.int(10, 12); }
      else if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO + FUTURE_OCCUPANCY_MEDIUM_RATIO + FUTURE_OCCUPANCY_HIGH_RATIO + FUTURE_OCCUPANCY_NEAR_FULL_RATIO) { occupancyTarget = rng.int(13, 14); }
      else { occupancyTarget = COLLECTIVE_SESSION_CAPACITY; }
      const session = await upsertStudioSession({ classTemplateId: def.template.id, classTypeId: def.classTypeId, teacherId: def.teacherId, title: def.template.title, description: def.template.description ?? undefined, location: def.template.location ?? undefined, startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000), capacity: COLLECTIVE_SESSION_CAPACITY });
      collectiveSessions.push({ id: session.id, startsAt, capacity: COLLECTIVE_SESSION_CAPACITY, classTypeId: def.classTypeId, isFuture: true, occupancyTarget });
    }
  }

  const catalogPrices = await prisma.price.findMany({
    where: { lookupKey: { in: ["collective-drop-in-eur-once-v1", "qa-collective-5-pack-eur-once-v1", "collective-10-pack-eur-once-v1", "monthly-unlimited-collective-eur-monthly-v1", "qa-private-5-pack-eur-once-v1"] }, isActive: true, isArchived: false },
    include: { product: true },
  });
  const priceByLookup = new Map(catalogPrices.map((p) => [p.lookupKey, p]));
  const entitlementRules = await prisma.entitlementRule.findMany({ where: { productId: { in: catalogPrices.map((p) => p.productId) }, isActive: true } });
  const entitlementRuleByProductId = new Map(entitlementRules.map((r) => [r.productId, r]));
  const requiredLookupKeys: PurchaseLookupKey[] = ["collective-drop-in-eur-once-v1", "qa-collective-5-pack-eur-once-v1", "collective-10-pack-eur-once-v1", "monthly-unlimited-collective-eur-monthly-v1", "qa-private-5-pack-eur-once-v1"];
  for (const lookupKey of requiredLookupKeys) {
    if (!priceByLookup.get(lookupKey)) throw new Error(`Scheduling seed missing required catalog price ${lookupKey}.`);
  }

  const ownershipOrder: OwnershipState[] = ["NO_PURCHASE", "EXPIRED_ONLY", "ACTIVE_DROP_IN", "ACTIVE_5_PACK", "ACTIVE_10_PACK", "ACTIVE_MONTHLY", "PRIVATE_ONLY"];
  const ownershipPool: OwnershipState[] = [];
  for (const state of ownershipOrder) { for (let i = 0; i < ownershipCounts[state]; i += 1) { ownershipPool.push(state); } }
  if (ownershipPool.length !== clients.length) throw new Error(`Ownership pool mismatch: ${ownershipPool.length} != ${clients.length}`);
  const ownershipPlan = rng.shuffle(clients).map((client, index) => ({ client, ownershipState: ownershipPool[index]! }));

  const usageTiers: UsageTier[] = ["HEAVY", "MODERATE", "LIGHT", "RETURNING", "INACTIVE"];
  const usagePool: UsageTier[] = [];
  for (const tier of usageTiers) { const count = Math.floor(clients.length * usageRatios[tier]); for (let i = 0; i < count; i += 1) { usagePool.push(tier); } }
  while (usagePool.length < clients.length) { usagePool.push("LIGHT"); }
  const usageByClientId = new Map<string, UsageTier>();
  const usageAssignmentOrder = rng.shuffle(ownershipPlan);
  for (let i = 0; i < clients.length; i += 1) { usageByClientId.set(usageAssignmentOrder[i]!.client.id, usagePool[i]!); }

  const entitlementsByClient = new Map<string, SeedEntitlementState[]>();
  let createdOrdersCount = 0;
  let createdPaymentsCount = 0;
  let createdEntitlementsCount = 0;
  let createdSubscriptionContractsCount = 0;
  let createdCreditLedgerEntriesCount = 0;

  const pushEntitlement = (state: SeedEntitlementState) => {
    const current = entitlementsByClient.get(state.clientId) ?? [];
    current.push(state);
    current.sort((a, b) => a.activatedAt.getTime() - b.activatedAt.getTime());
    entitlementsByClient.set(state.clientId, current);
  };

  const createCommercialPurchase = async (input: { clientId: string; lookupKey: PurchaseLookupKey; purchasedAt: Date }) => {
    const price = priceByLookup.get(input.lookupKey);
    if (!price) throw new Error(`Missing price for ${input.lookupKey}.`);
    const rule = entitlementRuleByProductId.get(price.productId);
    if (!rule) throw new Error(`Missing entitlement rule for product ${price.productId}.`);
    const totalAmountMinor = price.unitAmountMinor;
    const order = await prisma.order.create({ data: { clientId: input.clientId, subtotalAmountMinor: totalAmountMinor, discountAmountMinor: 0, totalAmountMinor, currencyCode: price.currencyCode, status: OrderStatus.PAID, placedAt: input.purchasedAt, notes: `seed-commercial-${input.lookupKey}` } });
    createdOrdersCount += 1;
    await prisma.orderItem.create({ data: { orderId: order.id, productId: price.productId, priceId: price.id, quantity: 1, productNameSnapshot: price.product.name, priceNameSnapshot: price.name, unitAmountMinor: totalAmountMinor, lineSubtotalAmountMinor: totalAmountMinor, lineDiscountAmountMinor: 0, lineTotalAmountMinor: totalAmountMinor, currencyCode: price.currencyCode } });
    await prisma.payment.create({ data: { orderId: order.id, status: PaymentStatus.SUCCEEDED, method: PaymentMethod.CARD, provider: PaymentProvider.STRIPE, providerReference: `seed-payment-${order.id}`, stripeCheckoutSessionId: `cs_test_seed_${order.id.slice(0, 20)}`, stripeCustomerId: `cus_seed_${input.clientId.slice(0, 12)}`, stripeCheckoutMode: price.priceType === PriceType.RECURRING ? StripeCheckoutMode.SUBSCRIPTION : StripeCheckoutMode.PAYMENT, amountMinor: totalAmountMinor, currencyCode: price.currencyCode, authorizedAt: input.purchasedAt, capturedAt: input.purchasedAt, createdAt: input.purchasedAt } });
    createdPaymentsCount += 1;

    let expiresAt: Date | null = null;
    let subscriptionContractId: string | null = null;
    if (price.priceType === PriceType.RECURRING) {
      const intervalCount = price.billingIntervalCount ?? 1;
      expiresAt = price.billingInterval === BillingInterval.MONTH ? addMonthsUtc(input.purchasedAt, intervalCount) : addDaysUtc(input.purchasedAt, 30 * intervalCount);
      const contractStatus = expiresAt > seedDayUtc ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED;
      const contract = await prisma.subscriptionContract.create({ data: { clientId: input.clientId, productId: price.productId, priceId: price.id, status: contractStatus, startsAt: input.purchasedAt, currentPeriodStart: input.purchasedAt, currentPeriodEnd: expiresAt, cancelAtPeriodEnd: contractStatus === SubscriptionStatus.EXPIRED, endedAt: contractStatus === SubscriptionStatus.EXPIRED ? expiresAt : null, provider: PaymentProvider.STRIPE, providerSubscriptionReference: `sub_seed_${order.id.slice(0, 20)}` } });
      subscriptionContractId = contract.id;
      createdSubscriptionContractsCount += 1;
    } else if (rule.validForDays && rule.validForDays > 0) {
      expiresAt = addDaysUtc(input.purchasedAt, rule.validForDays);
    }

    const entitlementStatus = expiresAt && expiresAt <= endOfUtcDay(seedDayUtc) ? ClientEntitlementStatus.EXPIRED : ClientEntitlementStatus.ACTIVE;
    const entitlement = await prisma.clientEntitlement.create({ data: { clientId: input.clientId, productId: price.productId, orderId: order.id, subscriptionContractId, entitlementType: rule.entitlementType, entitlementScope: rule.entitlementScope, status: entitlementStatus, activatedAt: input.purchasedAt, expiresAt } });
    createdEntitlementsCount += 1;

    let creditsGranted = 0;
    if (rule.entitlementType === EntitlementType.SINGLE_USE) { creditsGranted = 1; }
    else if (rule.entitlementType === EntitlementType.CREDIT_PACK) { creditsGranted = rule.quantity ?? 0; }
    if (creditsGranted > 0) {
      await prisma.creditLedgerEntry.create({ data: { clientId: input.clientId, entryType: CreditLedgerEntryType.GRANT, amount: creditsGranted, happenedAt: input.purchasedAt, entitlementId: entitlement.id, orderId: order.id, notes: `Seed entitlement grant (${input.lookupKey})` } });
      createdCreditLedgerEntriesCount += 1;
    }
    pushEntitlement({ id: entitlement.id, orderId: order.id, priceId: price.id, clientId: input.clientId, entitlementScope: rule.entitlementScope, activatedAt: input.purchasedAt, expiresAt, unlimitedAccess: rule.entitlementType === EntitlementType.UNLIMITED_ACCESS, creditsRemaining: creditsGranted });
  };

  const purchaseDaysAgo = (minDays: number, maxDays: number) => rng.int(minDays, maxDays);
  for (const entry of ownershipPlan) {
    const clientId = entry.client.id;
    switch (entry.ownershipState) {
      case "NO_PURCHASE": break;
      case "EXPIRED_ONLY":
        await createCommercialPurchase({ clientId, lookupKey: "qa-collective-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(95, 118)) });
        if (rng.next() < 0.35) await createCommercialPurchase({ clientId, lookupKey: "collective-drop-in-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 80)) });
        break;
      case "ACTIVE_DROP_IN":
        await createCommercialPurchase({ clientId, lookupKey: "collective-drop-in-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(2, 21)) });
        if (rng.next() < 0.4) await createCommercialPurchase({ clientId, lookupKey: "collective-drop-in-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 90)) });
        break;
      case "ACTIVE_5_PACK":
        await createCommercialPurchase({ clientId, lookupKey: "qa-collective-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(1, 50)) });
        if (rng.next() < 0.55) await createCommercialPurchase({ clientId, lookupKey: "qa-collective-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(55, 115)) });
        break;
      case "ACTIVE_10_PACK":
        await createCommercialPurchase({ clientId, lookupKey: "collective-10-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(1, 70)) });
        if (rng.next() < 0.4) await createCommercialPurchase({ clientId, lookupKey: "qa-collective-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(75, 118)) });
        break;
      case "ACTIVE_MONTHLY":
        await createCommercialPurchase({ clientId, lookupKey: "monthly-unlimited-collective-eur-monthly-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(2, 22)) });
        if (rng.next() < 0.7) await createCommercialPurchase({ clientId, lookupKey: "monthly-unlimited-collective-eur-monthly-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 55)) });
        if (rng.next() < 0.35) await createCommercialPurchase({ clientId, lookupKey: "qa-collective-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(60, 110)) });
        break;
      case "PRIVATE_ONLY":
        await createCommercialPurchase({ clientId, lookupKey: "qa-private-5-pack-eur-once-v1", purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(10, 90)) });
        break;
    }
  }

  const bookedPairs = new Set<string>();
  let createdPastBookingsCount = 0;
  let createdFutureBookingsCount = 0;
  const tierWeight: Record<UsageTier, number> = { HEAVY: 8, MODERATE: 5, LIGHT: 3, RETURNING: 2, INACTIVE: 0.2 };
  const recentlyActiveWindowStart = addDaysUtc(seedDayUtc, -21);

  const pickEntitlementForSession = (clientId: string, sessionStartsAt: Date): SeedEntitlementState | undefined => {
    const entries = entitlementsByClient.get(clientId) ?? [];
    return entries.find((entry) => {
      if (entry.entitlementScope !== EntitlementScope.COLLECTIVE_CLASSES) return false;
      if (sessionStartsAt < entry.activatedAt) return false;
      if (entry.expiresAt && sessionStartsAt > entry.expiresAt) return false;
      return entry.unlimitedAccess || entry.creditsRemaining > 0;
    });
  };

  const ownershipStateByClientId = new Map(ownershipPlan.map((entry) => [entry.client.id, entry.ownershipState]));
  const chooseCandidatesForSession = (session: CollectiveSessionSeed) => {
    const candidates: Array<{ client: (typeof clients)[number]; weight: number }> = [];
    for (const client of clients) {
      const pairKey = `${client.id}::${session.id}`;
      if (bookedPairs.has(pairKey)) continue;
      const entitlement = pickEntitlementForSession(client.id, session.startsAt);
      if (!entitlement) continue;
      const usageTier = usageByClientId.get(client.id) ?? "LIGHT";
      if (usageTier === "INACTIVE" && session.startsAt >= addDaysUtc(seedDayUtc, -30)) continue;
      if (usageTier === "RETURNING" && session.startsAt > recentlyActiveWindowStart && session.startsAt < seedDayUtc) continue;
      if (ownershipStateByClientId.get(client.id) === "ACTIVE_DROP_IN" && session.isFuture && rng.next() < 0.85) continue;
      candidates.push({ client, weight: tierWeight[usageTier] ?? 1 });
    }
    return candidates;
  };

  const weightedPick = <T>(items: Array<{ value: T; weight: number }>): T | null => {
    if (items.length === 0) return null;
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) return null;
    const target = rng.next() * totalWeight;
    let cursor = 0;
    for (const item of items) { cursor += item.weight; if (target <= cursor) return item.value; }
    return items[items.length - 1]!.value;
  };

  const createBookingFromEntitlement = async (input: { client: (typeof clients)[number]; session: CollectiveSessionSeed; entitlement: SeedEntitlementState; status: BookingStatus; cancelledAt?: Date }) => {
    const pairKey = `${input.client.id}::${input.session.id}`;
    if (bookedPairs.has(pairKey)) return false;
    const bookedAt = addDaysUtc(input.session.startsAt, -rng.int(1, 8));
    const cancellationEligibleUntilAt = addDaysUtc(input.session.startsAt, -1);
    cancellationEligibleUntilAt.setUTCHours(input.session.startsAt.getUTCHours(), input.session.startsAt.getUTCMinutes(), 0, 0);
    const booking = await prisma.booking.create({ data: { clientId: input.client.id, studioSessionId: input.session.id, orderId: input.entitlement.orderId, status: input.status, bookingIntent: BookingIntent.USE_PLAN, paymentSelection: BookingPaymentSelection.EXISTING_PLAN, selectedEntitlementId: input.entitlement.id, selectedPriceId: input.entitlement.priceId, bookedAt, customerName: input.client.name, customerEmail: input.client.email, consentTermsAccepted: true, consentPrivacyAccepted: true, consentAcceptedAt: bookedAt, cancellationEligibleUntilAt, cancelledAt: input.cancelledAt ?? null, creditRefundedAt: input.status === BookingStatus.CANCELLED ? input.cancelledAt ?? bookedAt : null } });
    bookedPairs.add(pairKey);

    if (!input.entitlement.unlimitedAccess) {
      input.entitlement.creditsRemaining -= 1;
      await prisma.creditLedgerEntry.create({ data: { clientId: input.client.id, entryType: CreditLedgerEntryType.CONSUME, amount: -1, happenedAt: bookedAt, entitlementId: input.entitlement.id, bookingId: booking.id, orderId: input.entitlement.orderId, notes: "Seed booking credit consumption" } });
      createdCreditLedgerEntriesCount += 1;
      if (input.status === BookingStatus.CANCELLED) {
        input.entitlement.creditsRemaining += 1;
        await prisma.creditLedgerEntry.create({ data: { clientId: input.client.id, entryType: CreditLedgerEntryType.RESTORE, amount: 1, happenedAt: input.cancelledAt ?? bookedAt, entitlementId: input.entitlement.id, bookingId: booking.id, orderId: input.entitlement.orderId, notes: "Seed cancellation credit restore" } });
        createdCreditLedgerEntriesCount += 1;
      }
    }

    if (input.session.isFuture) { createdFutureBookingsCount += 1; } else { createdPastBookingsCount += 1; }
    return true;
  };

  collectiveSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const session of collectiveSessions) {
    const sessionCandidates = chooseCandidatesForSession(session);
    let createdForSession = 0;
    let guard = 0;
    while (createdForSession < session.occupancyTarget && guard < 700) {
      guard += 1;
      const selectedClient = weightedPick(sessionCandidates.map((candidate) => ({ value: candidate.client, weight: candidate.weight })));
      if (!selectedClient) break;
      const entitlement = pickEntitlementForSession(selectedClient.id, session.startsAt);
      if (!entitlement) continue;
      let status: BookingStatus = session.isFuture ? BookingStatus.CONFIRMED : BookingStatus.COMPLETED;
      let cancelledAt: Date | undefined;
      if (!session.isFuture) {
        const statusScore = rng.next();
        if (statusScore < 0.08) { status = BookingStatus.CANCELLED; cancelledAt = addDaysUtc(session.startsAt, -2); }
        else if (statusScore < 0.18) { status = BookingStatus.NO_SHOW; }
      }
      const created = await createBookingFromEntitlement({ client: selectedClient, session, entitlement, status, cancelledAt });
      if (!created) continue;
      createdForSession += 1;
    }
  }

  const countByOwnership = (state: OwnershipState) => ownershipPlan.filter((e) => e.ownershipState === state).length;
  const pastSessionsCount = collectiveSessions.filter((s) => !s.isFuture).length;
  const futureSessions = collectiveSessions.filter((s) => s.isFuture);

  return {
    clientsSeeded: clients.length,
    pastSessionsCount,
    futureSessionsCount: futureSessions.length,
    collectiveSessionCapacity: COLLECTIVE_SESSION_CAPACITY,
    ordersCreatedCount: createdOrdersCount,
    paymentsCreatedCount: createdPaymentsCount,
    entitlementsCreatedCount: createdEntitlementsCount,
    subscriptionContractsCreatedCount: createdSubscriptionContractsCount,
    creditLedgerEntriesCreatedCount: createdCreditLedgerEntriesCount,
    pastBookingsCount: createdPastBookingsCount,
    futureBookingsCount: createdFutureBookingsCount,
    nearFullFutureSessionsCount: futureSessions.filter((s) => s.occupancyTarget >= 13).length,
    fullFutureSessionsCount: futureSessions.filter((s) => s.occupancyTarget >= COLLECTIVE_SESSION_CAPACITY).length,
    ownershipDistribution: {
      noPurchase: countByOwnership("NO_PURCHASE"), expiredOnly: countByOwnership("EXPIRED_ONLY"),
      activeDropIn: countByOwnership("ACTIVE_DROP_IN"), active5Pack: countByOwnership("ACTIVE_5_PACK"),
      active10Pack: countByOwnership("ACTIVE_10_PACK"), activeMonthly: countByOwnership("ACTIVE_MONTHLY"),
      privateOnly: countByOwnership("PRIVATE_ONLY"),
    },
  };
}

// ─── Learning (from JSON) ─────────────────────────────────────────────────────

async function seedLearningFromJson() {
  const learningJsonPath = resolve(process.env.LEARNING_SEED_JSON_PATH?.trim() || DEFAULT_LEARNING_SEED_JSON_PATH);
  const raw = await readFile(learningJsonPath, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; } catch { throw new Error(`Learning seed JSON is invalid: ${learningJsonPath}`); }
  if (!isRecord(parsed)) throw new Error(`Learning seed JSON root must be an object: ${learningJsonPath}`);

  const courseRecordsRaw = parsed.courses;
  if (!Array.isArray(courseRecordsRaw) || courseRecordsRaw.length === 0) throw new Error(`Learning seed JSON must contain a non-empty 'courses' array: ${learningJsonPath}`);

  const courseInputs: LearningCourseSeedInput[] = [];
  for (const [index, item] of courseRecordsRaw.entries()) {
    if (!isRecord(item)) throw new Error(`courses[${index}] must be an object in ${learningJsonPath}`);
    const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
    const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));
    const category = asRequiredString(pickFirstDefined(item, ["category", "Category"]));
    if (!legacyId || !title || !category) throw new Error(`courses[${index}] is missing required fields (ID/Title/Category) in ${learningJsonPath}`);
    const priority = asOptionalNumber(pickFirstDefined(item, ["priority", "Priority"])) ?? index + 1;
    courseInputs.push({ legacyId, title, description: asOptionalString(pickFirstDefined(item, ["description", "Description"])), shortDescription: asOptionalString(pickFirstDefined(item, ["shortDescription", "Short Description"])), category, categoryType: asOptionalString(pickFirstDefined(item, ["categoryType", "Category Type"])), categoryLevel: asOptionalString(pickFirstDefined(item, ["categoryLevel", "Category Level"])), thumbnail: assertLearningImagePath(asOptionalString(pickFirstDefined(item, ["thumbnail", "Thumbnail"])), `courses[${index}].thumbnail`) ?? undefined, videoUrl: asOptionalString(pickFirstDefined(item, ["videoUrl", "VideoURL"])), priority });
  }

  const programInputs: LearningProgramSeedInput[] = [];
  if (Array.isArray(parsed.programs) && parsed.programs.length > 0) {
    for (const [index, item] of parsed.programs.entries()) {
      if (!isRecord(item)) throw new Error(`programs[${index}] must be an object in ${learningJsonPath}`);
      const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
      const mainTitle = asRequiredString(pickFirstDefined(item, ["mainTitle", "MainTitle"]));
      const courseType = asRequiredString(pickFirstDefined(item, ["courseType", "CourseType"]));
      const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));
      if (!legacyId || !mainTitle || !courseType || !title) throw new Error(`programs[${index}] is missing required fields in ${learningJsonPath}`);
      programInputs.push({ legacyId, mainTitle, mainDescription: asOptionalString(pickFirstDefined(item, ["mainDescription", "MainDescription"])), courseType, title, description1: asOptionalString(pickFirstDefined(item, ["description1", "Description1"])), description2: asOptionalString(pickFirstDefined(item, ["description2", "Description2"])), description3: asOptionalString(pickFirstDefined(item, ["description3", "Description3"])), videoPromo: asOptionalString(pickFirstDefined(item, ["videoPromo", "VideoPromo"])), picture1: assertLearningImagePath(asOptionalString(pickFirstDefined(item, ["picture1", "Picture1"])), `programs[${index}].picture1`) ?? undefined, picture2: assertLearningImagePath(asOptionalString(pickFirstDefined(item, ["picture2", "Picture2"])), `programs[${index}].picture2`) ?? undefined, picture3: assertLearningImagePath(asOptionalString(pickFirstDefined(item, ["picture3", "Picture3"])), `programs[${index}].picture3`) ?? undefined });
    }
  } else {
    const seedByCategory = new Map<string, { summary?: string; thumbnail?: string; videoUrl?: string }>();
    for (const course of courseInputs) { if (seedByCategory.has(course.category)) continue; seedByCategory.set(course.category, { summary: course.shortDescription ?? course.description, thumbnail: course.thumbnail, videoUrl: course.videoUrl }); }
    for (const [category, seed] of seedByCategory.entries()) {
      const suffix = slugifyForLegacyId(category);
      programInputs.push({ legacyId: `program-${suffix}`, mainTitle: category, mainDescription: seed.summary, courseType: category, title: category, description1: seed.summary, description2: undefined, description3: undefined, videoPromo: seed.videoUrl, picture1: seed.thumbnail, picture2: seed.thumbnail, picture3: seed.thumbnail });
    }
  }

  const programByCourseType = new Set(programInputs.map((p) => p.courseType));
  const coursesWithoutProgram = courseInputs.filter((c) => !programByCourseType.has(c.category)).map((c) => c.category);
  if (coursesWithoutProgram.length > 0) throw new Error(`Learning seed JSON has courses mapped to unknown categories: ${[...new Set(coursesWithoutProgram)].join(", ")}`);

  for (const program of programInputs) {
    await prisma.learningProgram.upsert({ where: { legacyId: program.legacyId }, update: { mainTitle: program.mainTitle, mainDescription: program.mainDescription, courseType: program.courseType, title: program.title, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 }, create: { legacyId: program.legacyId, mainTitle: program.mainTitle, mainDescription: program.mainDescription, courseType: program.courseType, title: program.title, description1: program.description1, description2: program.description2, description3: program.description3, videoPromo: program.videoPromo, picture1: program.picture1, picture2: program.picture2, picture3: program.picture3 } });
  }
  for (const course of courseInputs) {
    await prisma.learningCourse.upsert({ where: { legacyId: course.legacyId }, update: { title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority }, create: { legacyId: course.legacyId, title: course.title, description: course.description, shortDescription: course.shortDescription, category: course.category, categoryType: course.categoryType, categoryLevel: course.categoryLevel, thumbnail: course.thumbnail, videoUrl: course.videoUrl, priority: course.priority } });
  }
  await prisma.learningCourse.deleteMany({ where: { legacyId: { notIn: courseInputs.map((c) => c.legacyId) } } });
  await prisma.learningProgram.deleteMany({ where: { legacyId: { notIn: programInputs.map((p) => p.legacyId) } } });

  console.info(`[seed:dev] Learning content seeded from JSON: programs=${programInputs.length}, courses=${courseInputs.length}.`);
}

// ─── Verification ─────────────────────────────────────────────────────────────

async function verifyCleanSeed(clientEmail: string, schedulingSummary: Awaited<ReturnType<typeof seedScheduling>>) {
  const [totalClients, verifiedActiveClientsWithProfile, totalAdminsAndMasterAdmins, totalTeachers] = await prisma.$transaction([
    prisma.user.count({ where: { role: Role.CLIENT } }),
    prisma.user.count({ where: { role: Role.CLIENT, emailVerified: { not: null }, isActive: true, isInactive: false, clientProfile: { isNot: null } } }),
    prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] } } }),
    prisma.user.count({ where: { role: Role.TEACHER } }),
  ]);

  if (totalClients !== SEED_CLIENT_COUNT) throw new Error(`Seed verification failed: expected ${SEED_CLIENT_COUNT} clients, got ${totalClients}.`);
  if (verifiedActiveClientsWithProfile !== SEED_CLIENT_COUNT) throw new Error(`Seed verification failed: expected ${SEED_CLIENT_COUNT} verified active clients with profiles, got ${verifiedActiveClientsWithProfile}.`);
  if (totalAdminsAndMasterAdmins !== 2) throw new Error(`Seed verification failed: expected 2 admin/master-admin users, got ${totalAdminsAndMasterAdmins}.`);
  if (totalTeachers !== 3) throw new Error(`Seed verification failed: expected 3 teachers, got ${totalTeachers}.`);

  const [productCount, collectivePastSessionsCount, collectiveFutureSessionsCount] = await prisma.$transaction([
    prisma.product.count({ where: { isActive: true, isArchived: false } }),
    prisma.studioSession.count({ where: { startsAt: { gte: pastWindowStartUtc, lte: pastWindowEndUtc }, classType: { category: { slug: { not: "private-reformer-coach" } } } } }),
    prisma.studioSession.count({ where: { startsAt: { gte: futureWindowStartUtc, lte: futureWindowEndUtc }, classType: { category: { slug: { not: "private-reformer-coach" } } } } }),
  ]);

  if (productCount !== 6) throw new Error(`Seed verification failed: expected 6 active products, got ${productCount}.`);
  if (collectivePastSessionsCount !== schedulingSummary.pastSessionsCount) throw new Error(`Seed verification failed: past collective session count mismatch (expected ${schedulingSummary.pastSessionsCount}, got ${collectivePastSessionsCount}).`);
  if (collectiveFutureSessionsCount !== schedulingSummary.futureSessionsCount) throw new Error(`Seed verification failed: future collective session count mismatch (expected ${schedulingSummary.futureSessionsCount}, got ${collectiveFutureSessionsCount}).`);

  const duplicateActiveBookings = await prisma.$queryRaw<Array<{ duplicate_count: string }>>`
    SELECT COUNT(*)::text AS duplicate_count FROM (
      SELECT "clientId", "studioSessionId", COUNT(*) AS row_count FROM "Booking"
      WHERE "clientId" IS NOT NULL AND status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
      GROUP BY "clientId", "studioSessionId" HAVING COUNT(*) > 1
    ) duplicates
  `;
  const duplicateCount = Number.parseInt(duplicateActiveBookings[0]?.duplicate_count ?? "0", 10);
  if (duplicateCount > 0) throw new Error(`Seed verification failed: found ${duplicateCount} duplicate active bookings.`);

  const client = await prisma.user.findUnique({ where: { email: clientEmail }, select: { id: true } });
  if (!client) throw new Error("Seed verification failed: QA client missing.");

  const scheduleCount = await prisma.siteWeeklyScheduleEntry.count({ where: { isActive: true } });
  if (scheduleCount === 0) throw new Error("Seed verification failed: no agenda schedule entries found.");

  console.info(`[seed:dev] Verification passed. clients=${totalClients}, products=${productCount}, pastSessions=${collectivePastSessionsCount}, futureSessions=${collectiveFutureSessionsCount}, scheduleEntries=${scheduleCount}.`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runDevelopmentSeed(): Promise<void> {
  console.info("[seed:dev] Starting development seed (mode: development — identical for DEV and UAT).");
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  await purgeForCleanSeed();
  const users = await seedUsers();
  await seedBookingPolicy();
  await seedCatalog(stripePriceIdByLookupKey);
  await seedMarketingDemoData({ createdById: users.admin.id });
  const schedulingSummary = await seedScheduling({ anaId: users.teachers.ana.id, elenaId: users.teachers.elena.id, sofiaId: users.teachers.sofia.id });
  await seedLearningFromJson();
  await seedAgendaSchedule();
  await verifyCleanSeed(users.client.email, schedulingSummary);

  console.info(
    `[seed:dev] Completed: clients=${schedulingSummary.clientsSeeded}, pastSessions=${schedulingSummary.pastSessionsCount}, futureSessions=${schedulingSummary.futureSessionsCount}, pastBookings=${schedulingSummary.pastBookingsCount}, futureBookings=${schedulingSummary.futureBookingsCount}, orders=${schedulingSummary.ordersCreatedCount}.`,
  );
}
