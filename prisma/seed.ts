import {
  BillingInterval,
  EntitlementScope,
  EntitlementType,
  PriceType,
  ProductType,
  Role,
  ServicePricingMode,
  StudioSessionStatus,
  Weekday,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const scheduleWindowStart = new Date();
scheduleWindowStart.setUTCHours(0, 0, 0, 0);
scheduleWindowStart.setUTCDate(scheduleWindowStart.getUTCDate() + 1);

const scheduleWindowEnd = new Date(scheduleWindowStart);
scheduleWindowEnd.setUTCDate(scheduleWindowEnd.getUTCDate() + 56);
scheduleWindowEnd.setUTCHours(23, 59, 59, 999);

const SCHEDULE_BLACKOUT_DATES = new Set<string>();
const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

type CatalogStripePriceEnvSpec = {
  productName: string;
  lookupKey: string;
  envVarName: string;
};

const PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS: CatalogStripePriceEnvSpec[] = [
  {
    productName: "Collective Class Drop-In",
    lookupKey: "collective-drop-in-eur-once-v1",
    envVarName: "STRIPE_PRICE_ID_COLLECTIVE_DROP_IN",
  },
  {
    productName: "5-Ticket Collective Classes",
    lookupKey: "qa-collective-5-pack-eur-once-v1",
    envVarName: "STRIPE_PRICE_ID_COLLECTIVE_5_PACK",
  },
  {
    productName: "10-Ticket Collective Classes",
    lookupKey: "collective-10-pack-eur-once-v1",
    envVarName: "STRIPE_PRICE_ID_COLLECTIVE_10_PACK",
  },
  {
    productName: "Monthly Recurrent Collective Subscription",
    lookupKey: "monthly-unlimited-collective-eur-monthly-v1",
    envVarName: "STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE",
  },
  {
    productName: "5-Ticket Private Classes",
    lookupKey: "qa-private-5-pack-eur-once-v1",
    envVarName: "STRIPE_PRICE_ID_PRIVATE_5_PACK",
  },
  {
    productName: "10-Ticket Private Classes",
    lookupKey: "qa-private-10-pack-eur-once-v1",
    envVarName: "STRIPE_PRICE_ID_PRIVATE_10_PACK",
  },
];

const DEFAULT_LEARNING_SEED_JSON_PATH = resolve(process.cwd(), "prisma", "seed-data", "learning-content.json");

type LearningProgramSeedInput = {
  legacyId: string;
  mainTitle: string;
  mainDescription?: string;
  courseType: string;
  title: string;
  description1?: string;
  description2?: string;
  description3?: string;
  videoPromo?: string;
  picture1?: string;
  picture2?: string;
  picture3?: string;
};

type LearningCourseSeedInput = {
  legacyId: string;
  title: string;
  description?: string;
  shortDescription?: string;
  category: string;
  categoryType?: string;
  categoryLevel?: string;
  thumbnail?: string;
  videoUrl?: string;
  priority: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

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

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function pickFirstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }

  return undefined;
}

function slugifyForLegacyId(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "uncategorized";
}

function resolveRequiredCatalogStripePriceIds(): Record<string, string> {
  const stripePriceIdByLookupKey: Record<string, string> = {};
  const missing: CatalogStripePriceEnvSpec[] = [];
  const invalid: Array<CatalogStripePriceEnvSpec & { value: string }> = [];

  for (const spec of PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS) {
    const value = process.env[spec.envVarName]?.trim();

    if (!value) {
      missing.push(spec);
      continue;
    }

    if (!STRIPE_PRICE_ID_PATTERN.test(value)) {
      invalid.push({ ...spec, value });
      continue;
    }

    stripePriceIdByLookupKey[spec.lookupKey] = value;
  }

  if (missing.length > 0 || invalid.length > 0) {
    const details = [
      missing.length > 0
        ? `Missing Stripe price env vars:\n${missing
            .map(
              (entry) =>
                `- ${entry.envVarName} (Product: ${entry.productName}, lookupKey: ${entry.lookupKey})`,
            )
            .join("\n")}`
        : null,
      invalid.length > 0
        ? `Invalid Stripe price env var values (expected Stripe Price IDs like price_...):\n${invalid
            .map(
              (entry) =>
                `- ${entry.envVarName}=${entry.value} (Product: ${entry.productName}, lookupKey: ${entry.lookupKey})`,
            )
            .join("\n")}`
        : null,
    ]
      .filter(Boolean)
      .join("\n\n");

    throw new Error(
      `Seed validation failed for purchasable catalog Stripe price configuration.\n${details}\n\n` +
        "Set all required STRIPE_PRICE_ID_* env vars before running the seed.",
    );
  }

  console.info("[seed] Stripe price configuration validated for purchasable catalog products:");
  for (const spec of PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS) {
    console.info(
      `  - ${spec.productName}: ${spec.envVarName}=${stripePriceIdByLookupKey[spec.lookupKey]} (${spec.lookupKey})`,
    );
  }

  return stripePriceIdByLookupKey;
}

function weekdayToJsDay(weekday: Weekday): number {
  switch (weekday) {
    case Weekday.MONDAY:
      return 1;
    case Weekday.TUESDAY:
      return 2;
    case Weekday.WEDNESDAY:
      return 3;
    case Weekday.THURSDAY:
      return 4;
    case Weekday.FRIDAY:
      return 5;
    case Weekday.SATURDAY:
      return 6;
    case Weekday.SUNDAY:
      return 0;
  }
}

function parseTime(time: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = time.split(":");
  return {
    hour: Number(hourRaw),
    minute: Number(minuteRaw),
  };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextOccurrencesInWindow(params: {
  weekday: Weekday;
  time: string;
  windowStart: Date;
  windowEnd: Date;
  extraSkipDates?: string[];
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

    if (candidate.getUTCDay() !== jsDay) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      continue;
    }

    const startsAt = new Date(
      Date.UTC(
        candidate.getUTCFullYear(),
        candidate.getUTCMonth(),
        candidate.getUTCDate(),
        hour,
        minute,
        0,
        0,
      ),
    );

    if (startsAt < windowStart || startsAt > windowEnd || skipDates.has(dateKey(startsAt))) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      continue;
    }

    result.push(startsAt);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

async function purgeForCleanSeed() {
  await prisma.attendanceRecord.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.studioSession.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.classType.deleteMany();
  await prisma.classCategory.deleteMany();

  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.clientEntitlement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.adminNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contactMessage.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionContract.deleteMany();

  await prisma.entitlementRule.deleteMany();
  await prisma.price.deleteMany();
  await prisma.product.deleteMany();

  await prisma.bookingPolicy.deleteMany();

  await prisma.clientProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUsers() {
  const masterPasswordHash = await hash("MasterAdmin123!", 12);
  const adminPasswordHash = await hash("Admin123!", 12);
  const teacherPasswordHash = await hash("Teacher123!", 12);
  const clientPasswordHash = await hash("Client123!", 12);

  const masterAdmin = await prisma.user.create({
    data: {
      name: "Master Admin",
      firstName: "Master",
      lastName: "Admin",
      email: "masteradmin@onthematstudio.local",
      role: Role.MASTER_ADMIN,
      passwordHash: masterPasswordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-20T08:00:00.000Z"),
    },
  });

  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      firstName: "Admin",
      lastName: "User",
      email: "admin@onthematstudio.local",
      role: Role.ADMIN,
      passwordHash: adminPasswordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-19T11:00:00.000Z"),
    },
  });

  const teacher = await prisma.user.create({
    data: {
      name: "Teacher User",
      firstName: "Teacher",
      lastName: "User",
      email: "teacher@onthematstudio.local",
      role: Role.TEACHER,
      passwordHash: teacherPasswordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-18T09:30:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000001",
          bio: "Yoga and pilates instructor.",
          specialties: ["yoga", "pilates"],
          certifications: ["RYT-200"],
          hireDate: new Date("2023-09-01T00:00:00.000Z"),
        },
      },
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client User",
      firstName: "Client",
      lastName: "User",
      email: "client@onthematstudio.local",
      role: Role.CLIENT,
      passwordHash: clientPasswordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-10T18:45:00.000Z"),
      clientProfile: {
        create: {
          phone: "+32000000002",
          notes: "Clean QA client account.",
        },
      },
    },
  });

  return { masterAdmin, admin, teacher, client };
}

async function seedBookingPolicy() {
  await prisma.bookingPolicy.create({
    data: {
      scope: "GLOBAL",
      cancellationCutoffHours: 24,
    },
  });
}

async function upsertProduct(input: {
  slug: string;
  name: string;
  description: string;
  productType: ProductType;
  sortOrder: number;
}) {
  return prisma.product.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      description: input.description,
      productType: input.productType,
      isActive: true,
      isArchived: false,
      sortOrder: input.sortOrder,
    },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description,
      productType: input.productType,
      isActive: true,
      isArchived: false,
      sortOrder: input.sortOrder,
    },
  });
}

async function upsertPrice(input: {
  productId: string;
  lookupKey: string;
  stripePriceId?: string;
  name: string;
  priceType: PriceType;
  currencyCode: string;
  unitAmountMinor: number;
  billingInterval?: BillingInterval;
  billingIntervalCount?: number;
}) {
  return prisma.price.upsert({
    where: { lookupKey: input.lookupKey },
    update: {
      productId: input.productId,
      name: input.name,
      stripePriceId: input.stripePriceId,
      priceType: input.priceType,
      currencyCode: input.currencyCode,
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: input.billingInterval,
      billingIntervalCount: input.billingIntervalCount,
      isActive: true,
      isArchived: false,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
    },
    create: {
      productId: input.productId,
      lookupKey: input.lookupKey,
      stripePriceId: input.stripePriceId,
      name: input.name,
      priceType: input.priceType,
      currencyCode: input.currencyCode,
      unitAmountMinor: input.unitAmountMinor,
      billingInterval: input.billingInterval,
      billingIntervalCount: input.billingIntervalCount,
      isActive: true,
      isArchived: false,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: null,
    },
  });
}

async function upsertEntitlementRule(input: {
  productId: string;
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  quantity?: number;
  validForDays?: number;
  notes?: string;
}) {
  return prisma.entitlementRule.upsert({
    where: {
      productId_entitlementType_entitlementScope: {
        productId: input.productId,
        entitlementType: input.entitlementType,
        entitlementScope: input.entitlementScope,
      },
    },
    update: {
      quantity: input.quantity,
      validForDays: input.validForDays,
      notes: input.notes,
      isActive: true,
    },
    create: {
      productId: input.productId,
      entitlementType: input.entitlementType,
      entitlementScope: input.entitlementScope,
      quantity: input.quantity,
      validForDays: input.validForDays,
      notes: input.notes,
      isActive: true,
    },
  });
}

async function assertPurchasableCatalogStripePriceIdsPersisted() {
  const seededPrices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS.map((spec) => spec.lookupKey),
      },
    },
    select: {
      lookupKey: true,
      stripePriceId: true,
    },
  });

  const missingStripeIdsAfterSeed = seededPrices
    .filter((price) => !price.stripePriceId)
    .map((price) => price.lookupKey);

  if (missingStripeIdsAfterSeed.length > 0) {
    throw new Error(
      "Seed verification failed: Stripe price IDs are missing after seed for lookup keys: " +
        missingStripeIdsAfterSeed.join(", "),
    );
  }

  const expectedLookupKeys = new Set(PURCHASABLE_CATALOG_STRIPE_PRICE_ENV_SPECS.map((spec) => spec.lookupKey));
  const seededLookupKeys = new Set(seededPrices.map((price) => price.lookupKey));
  const missingRows = [...expectedLookupKeys].filter((lookupKey) => !seededLookupKeys.has(lookupKey));
  if (missingRows.length > 0) {
    throw new Error(
      "Seed verification failed: expected purchasable catalog prices were not created for lookup keys: " +
        missingRows.join(", "),
    );
  }

  console.info(
    `[seed] Verified Stripe-linked purchasable catalog prices: ${seededPrices.length}/${expectedLookupKeys.size}.`,
  );
}

async function seedCatalog(stripePriceIdByLookupKey: Record<string, string>) {
  const collectiveDropIn = await upsertProduct({
    slug: "collective-drop-in",
    name: "Collective Class Drop-In",
    description: "Single booking access for collective yoga, pilates and functional classes.",
    productType: ProductType.DROP_IN_CLASS,
    sortOrder: 10,
  });
  await upsertPrice({
    productId: collectiveDropIn.id,
    lookupKey: "collective-drop-in-eur-once-v1",
    stripePriceId: stripePriceIdByLookupKey["collective-drop-in-eur-once-v1"],
    name: "Collective Drop-In - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 2200,
  });
  await upsertEntitlementRule({
    productId: collectiveDropIn.id,
    entitlementType: EntitlementType.SINGLE_USE,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    quantity: 1,
    validForDays: 30,
    notes: "Single collective class booking entitlement.",
  });

  const collectiveFivePack = await upsertProduct({
    slug: "collective-5-class-pack",
    name: "5-Ticket Collective Classes",
    description: "Five class credits for collective classes.",
    productType: ProductType.CLASS_PACK,
    sortOrder: 20,
  });
  await upsertPrice({
    productId: collectiveFivePack.id,
    lookupKey: "qa-collective-5-pack-eur-once-v1",
    stripePriceId: stripePriceIdByLookupKey["qa-collective-5-pack-eur-once-v1"],
    name: "5-Class Pack - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 9500,
  });
  await upsertEntitlementRule({
    productId: collectiveFivePack.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    quantity: 5,
    validForDays: 90,
    notes: "Five credits for collective class bookings.",
  });

  const collectiveTenPack = await upsertProduct({
    slug: "collective-10-class-pack",
    name: "10-Ticket Collective Classes",
    description: "Ten class credits for collective classes.",
    productType: ProductType.CLASS_PACK,
    sortOrder: 30,
  });
  await upsertPrice({
    productId: collectiveTenPack.id,
    lookupKey: "collective-10-pack-eur-once-v1",
    stripePriceId: stripePriceIdByLookupKey["collective-10-pack-eur-once-v1"],
    name: "10-Class Pack - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 17900,
  });
  await upsertEntitlementRule({
    productId: collectiveTenPack.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    quantity: 10,
    validForDays: 120,
    notes: "Ten credits for collective class bookings.",
  });

  const collectiveMonthlySubscription = await upsertProduct({
    slug: "monthly-unlimited-collective",
    name: "Monthly Recurrent Collective Subscription",
    description: "Recurring monthly subscription for collective classes.",
    productType: ProductType.UNLIMITED_MEMBERSHIP,
    sortOrder: 40,
  });
  await upsertPrice({
    productId: collectiveMonthlySubscription.id,
    lookupKey: "monthly-unlimited-collective-eur-monthly-v1",
    stripePriceId: stripePriceIdByLookupKey["monthly-unlimited-collective-eur-monthly-v1"],
    name: "Monthly Unlimited Collective - Monthly",
    priceType: PriceType.RECURRING,
    currencyCode: "EUR",
    unitAmountMinor: 12900,
    billingInterval: BillingInterval.MONTH,
    billingIntervalCount: 1,
  });
  await upsertEntitlementRule({
    productId: collectiveMonthlySubscription.id,
    entitlementType: EntitlementType.UNLIMITED_ACCESS,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    validForDays: 30,
    notes: "Unlimited access entitlement for active subscription period.",
  });

  const privateFivePack = await upsertProduct({
    slug: "private-5-class-pack",
    name: "5-Ticket Private Classes",
    description: "Five private class credits.",
    productType: ProductType.CLASS_PACK,
    sortOrder: 50,
  });
  await upsertPrice({
    productId: privateFivePack.id,
    lookupKey: "qa-private-5-pack-eur-once-v1",
    stripePriceId: stripePriceIdByLookupKey["qa-private-5-pack-eur-once-v1"],
    name: "5-Private Sessions - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 32000,
  });
  await upsertEntitlementRule({
    productId: privateFivePack.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.PRIVATE_CLASSES,
    quantity: 5,
    validForDays: 180,
    notes: "Five credits for private classes.",
  });

  const privateTenPack = await upsertProduct({
    slug: "private-10-class-pack",
    name: "10-Ticket Private Classes",
    description: "Ten private class credits.",
    productType: ProductType.CLASS_PACK,
    sortOrder: 60,
  });
  await upsertPrice({
    productId: privateTenPack.id,
    lookupKey: "qa-private-10-pack-eur-once-v1",
    stripePriceId: stripePriceIdByLookupKey["qa-private-10-pack-eur-once-v1"],
    name: "10-Private Sessions - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 60000,
  });
  await upsertEntitlementRule({
    productId: privateTenPack.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.PRIVATE_CLASSES,
    quantity: 10,
    validForDays: 240,
    notes: "Ten credits for private classes.",
  });

  await assertPurchasableCatalogStripePriceIdsPersisted();
}

async function upsertClassCategory(input: {
  slug: string;
  name: string;
  description: string;
  sortOrder: number;
}) {
  return prisma.classCategory.upsert({
    where: { slug: input.slug },
    update: {
      name: input.name,
      description: input.description,
      isActive: true,
      sortOrder: input.sortOrder,
    },
    create: {
      slug: input.slug,
      name: input.name,
      description: input.description,
      isActive: true,
      sortOrder: input.sortOrder,
    },
  });
}

async function upsertClassType(input: {
  slug: string;
  categoryId: string;
  name: string;
  description: string;
  imageUrl: string;
  defaultDurationMinutes: number;
  defaultCapacity: number;
  pricingMode: ServicePricingMode;
  sortOrder: number;
}) {
  return prisma.classType.upsert({
    where: { slug: input.slug },
    update: {
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl,
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      pricingMode: input.pricingMode,
      isActive: true,
      isVisible: true,
      sortOrder: input.sortOrder,
    },
    create: {
      slug: input.slug,
      categoryId: input.categoryId,
      name: input.name,
      description: input.description,
      imageUrl: input.imageUrl,
      defaultDurationMinutes: input.defaultDurationMinutes,
      defaultCapacity: input.defaultCapacity,
      pricingMode: input.pricingMode,
      isActive: true,
      isVisible: true,
      sortOrder: input.sortOrder,
    },
  });
}

async function upsertClassTemplate(input: {
  slug: string;
  classTypeId: string;
  defaultTeacherId: string;
  title: string;
  description: string;
  location: string;
  defaultCapacity: number;
  defaultDurationMinutes: number;
}) {
  return prisma.classTemplate.upsert({
    where: { slug: input.slug },
    update: {
      classTypeId: input.classTypeId,
      defaultTeacherId: input.defaultTeacherId,
      title: input.title,
      description: input.description,
      location: input.location,
      defaultCapacity: input.defaultCapacity,
      defaultDurationMinutes: input.defaultDurationMinutes,
      isActive: true,
      isPublished: true,
    },
    create: {
      slug: input.slug,
      classTypeId: input.classTypeId,
      defaultTeacherId: input.defaultTeacherId,
      title: input.title,
      description: input.description,
      location: input.location,
      defaultCapacity: input.defaultCapacity,
      defaultDurationMinutes: input.defaultDurationMinutes,
      isActive: true,
      isPublished: true,
    },
  });
}

async function upsertRecurringRule(input: {
  classTemplateId: string;
  weekday: Weekday;
  startTime: string;
  startDate: Date;
  endDate?: Date;
}) {
  return prisma.recurringRule.upsert({
    where: {
      classTemplateId_weekday_startTime_startDate: {
        classTemplateId: input.classTemplateId,
        weekday: input.weekday,
        startTime: input.startTime,
        startDate: input.startDate,
      },
    },
    update: {
      endDate: input.endDate,
      isActive: true,
    },
    create: {
      classTemplateId: input.classTemplateId,
      weekday: input.weekday,
      startTime: input.startTime,
      startDate: input.startDate,
      endDate: input.endDate,
      isActive: true,
    },
  });
}

async function upsertStudioSession(input: {
  classTemplateId: string;
  recurringRuleId?: string;
  classTypeId: string;
  teacherId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}) {
  return prisma.studioSession.upsert({
    where: {
      classTemplateId_startsAt: {
        classTemplateId: input.classTemplateId,
        startsAt: input.startsAt,
      },
    },
    update: {
      recurringRuleId: input.recurringRuleId,
      classTypeId: input.classTypeId,
      teacherId: input.teacherId,
      title: input.title,
      description: input.description,
      location: input.location,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: StudioSessionStatus.SCHEDULED,
      cancelledAt: null,
      cancelledReason: null,
      cancelledById: null,
      isPublished: true,
    },
    create: {
      classTemplateId: input.classTemplateId,
      recurringRuleId: input.recurringRuleId,
      classTypeId: input.classTypeId,
      teacherId: input.teacherId,
      title: input.title,
      description: input.description,
      location: input.location,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      capacity: input.capacity,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
  });
}

async function seedScheduling(teacherId: string) {
  const yogaCategory = await upsertClassCategory({
    slug: "yoga-collective-classes",
    name: "Yoga Collective Classes",
    description: "Dynamic and restorative yoga classes for collective groups.",
    sortOrder: 10,
  });
  const pilatesCategory = await upsertClassCategory({
    slug: "pilates-collective-classes",
    name: "Pilates Collective Classes",
    description: "Mat and reformer-inspired pilates sessions in small groups.",
    sortOrder: 20,
  });
  const fitnessCategory = await upsertClassCategory({
    slug: "fitness-functional",
    name: "Fitness & Functional",
    description: "Strength, mobility, and conditioning sessions.",
    sortOrder: 30,
  });
  const privateCategory = await upsertClassCategory({
    slug: "private-reformer-coach",
    name: "Private Reformer Coach",
    description: "Private reformer coaching and technique refinement.",
    sortOrder: 40,
  });

  const vinyasaYoga = await upsertClassType({
    slug: "vinyasa-yoga",
    categoryId: yogaCategory.id,
    name: "Vinyasa Yoga",
    description: "Breath-led flowing yoga for strength and mobility.",
    imageUrl: "/images/classes/vinyasa-yoga.jpg",
    defaultDurationMinutes: 60,
    defaultCapacity: 22,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const rocketYoga = await upsertClassType({
    slug: "rocket-yoga",
    categoryId: yogaCategory.id,
    name: "Rocket Yoga",
    description: "High-energy yoga sequencing with progressive options.",
    imageUrl: "/images/classes/rocket-yoga.jpg",
    defaultDurationMinutes: 75,
    defaultCapacity: 16,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 20,
  });
  const hathaYoga = await upsertClassType({
    slug: "hatha-yoga",
    categoryId: yogaCategory.id,
    name: "Hatha Yoga",
    description: "Slower paced foundational yoga and alignment practice.",
    imageUrl: "/images/classes/hatha-yoga.jpg",
    defaultDurationMinutes: 60,
    defaultCapacity: 18,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 30,
  });
  const matPilates = await upsertClassType({
    slug: "mat-pilates",
    categoryId: pilatesCategory.id,
    name: "Mat Pilates",
    description: "Core-driven pilates session suitable for all levels.",
    imageUrl: "/images/classes/mat-pilates.jpg",
    defaultDurationMinutes: 50,
    defaultCapacity: 18,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const reformerFoundations = await upsertClassType({
    slug: "reformer-foundations",
    categoryId: pilatesCategory.id,
    name: "Reformer Foundations",
    description: "Small group reformer fundamentals for technique and control.",
    imageUrl: "/images/classes/reformer-foundations.jpg",
    defaultDurationMinutes: 55,
    defaultCapacity: 10,
    pricingMode: ServicePricingMode.PLAN_ONLY,
    sortOrder: 20,
  });
  const functionalStrength = await upsertClassType({
    slug: "functional-strength",
    categoryId: fitnessCategory.id,
    name: "Functional Strength",
    description: "Strength and conditioning with athletic movement patterns.",
    imageUrl: "/images/classes/functional-strength.jpg",
    defaultDurationMinutes: 45,
    defaultCapacity: 14,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const privateReformerCoaching = await upsertClassType({
    slug: "private-reformer-coaching",
    categoryId: privateCategory.id,
    name: "Private Reformer Coaching",
    description: "Private 1:1 or duo coaching on the reformer.",
    imageUrl: "/images/classes/private-reformer-coaching.jpg",
    defaultDurationMinutes: 50,
    defaultCapacity: 2,
    pricingMode: ServicePricingMode.PLAN_ONLY,
    sortOrder: 10,
  });

  const vinyasaTemplate = await upsertClassTemplate({
    slug: "vinyasa-flow-brussels",
    classTypeId: vinyasaYoga.id,
    defaultTeacherId: teacherId,
    title: "Vinyasa Flow Brussels",
    description: "A full-spectrum vinyasa class with warm-up, flow and cooldown.",
    location: "Ixelles Studio A",
    defaultCapacity: vinyasaYoga.defaultCapacity,
    defaultDurationMinutes: vinyasaYoga.defaultDurationMinutes,
  });
  const rocketTemplate = await upsertClassTemplate({
    slug: "rocket-yoga-power-sequence",
    classTypeId: rocketYoga.id,
    defaultTeacherId: teacherId,
    title: "Rocket Yoga Power Sequence",
    description: "Progressive rocket yoga with core and inversion prep.",
    location: "Ixelles Studio B",
    defaultCapacity: rocketYoga.defaultCapacity,
    defaultDurationMinutes: rocketYoga.defaultDurationMinutes,
  });
  const hathaTemplate = await upsertClassTemplate({
    slug: "hatha-reset-weekend",
    classTypeId: hathaYoga.id,
    defaultTeacherId: teacherId,
    title: "Hatha Reset Weekend",
    description: "Grounding hatha class focused on breath and posture quality.",
    location: "Ixelles Studio A",
    defaultCapacity: hathaYoga.defaultCapacity,
    defaultDurationMinutes: hathaYoga.defaultDurationMinutes,
  });
  const matPilatesTemplate = await upsertClassTemplate({
    slug: "mat-pilates-core-lab",
    classTypeId: matPilates.id,
    defaultTeacherId: teacherId,
    title: "Mat Pilates Core Lab",
    description: "Core and glute-focused mat pilates with progression options.",
    location: "Etterbeek Studio C",
    defaultCapacity: matPilates.defaultCapacity,
    defaultDurationMinutes: matPilates.defaultDurationMinutes,
  });
  const reformerTemplate = await upsertClassTemplate({
    slug: "reformer-foundations-small-group",
    classTypeId: reformerFoundations.id,
    defaultTeacherId: teacherId,
    title: "Reformer Foundations Small Group",
    description: "Technique-first reformer foundations for beginners.",
    location: "Ixelles Reformer Room",
    defaultCapacity: reformerFoundations.defaultCapacity,
    defaultDurationMinutes: reformerFoundations.defaultDurationMinutes,
  });
  const functionalTemplate = await upsertClassTemplate({
    slug: "functional-strength-express",
    classTypeId: functionalStrength.id,
    defaultTeacherId: teacherId,
    title: "Functional Strength Express",
    description: "High-focus functional strength class with mobility warm-up.",
    location: "Etterbeek Performance Room",
    defaultCapacity: functionalStrength.defaultCapacity,
    defaultDurationMinutes: functionalStrength.defaultDurationMinutes,
  });
  const privateReformerTemplate = await upsertClassTemplate({
    slug: "private-reformer-coaching-slot",
    classTypeId: privateReformerCoaching.id,
    defaultTeacherId: teacherId,
    title: "Private Reformer Coaching",
    description: "Private coaching slot tailored to goals and mobility.",
    location: "Ixelles Private Studio",
    defaultCapacity: privateReformerCoaching.defaultCapacity,
    defaultDurationMinutes: privateReformerCoaching.defaultDurationMinutes,
  });

  const recurringDefinitions = [
    { template: vinyasaTemplate, classType: vinyasaYoga, weekday: Weekday.MONDAY, startTime: "07:00" },
    { template: vinyasaTemplate, classType: vinyasaYoga, weekday: Weekday.WEDNESDAY, startTime: "18:30" },
    { template: rocketTemplate, classType: rocketYoga, weekday: Weekday.SATURDAY, startTime: "09:00" },
    { template: hathaTemplate, classType: hathaYoga, weekday: Weekday.SUNDAY, startTime: "10:30" },
    { template: matPilatesTemplate, classType: matPilates, weekday: Weekday.TUESDAY, startTime: "12:15" },
    { template: matPilatesTemplate, classType: matPilates, weekday: Weekday.THURSDAY, startTime: "19:00" },
    { template: reformerTemplate, classType: reformerFoundations, weekday: Weekday.FRIDAY, startTime: "17:30" },
    { template: functionalTemplate, classType: functionalStrength, weekday: Weekday.TUESDAY, startTime: "07:00" },
    { template: functionalTemplate, classType: functionalStrength, weekday: Weekday.THURSDAY, startTime: "07:00" },
    { template: privateReformerTemplate, classType: privateReformerCoaching, weekday: Weekday.WEDNESDAY, startTime: "12:00" },
    { template: privateReformerTemplate, classType: privateReformerCoaching, weekday: Weekday.SATURDAY, startTime: "11:30" },
  ] as const;

  for (const definition of recurringDefinitions) {
    const recurringRule = await upsertRecurringRule({
      classTemplateId: definition.template.id,
      weekday: definition.weekday,
      startTime: definition.startTime,
      startDate: scheduleWindowStart,
      endDate: scheduleWindowEnd,
    });

    const startsAtList = nextOccurrencesInWindow({
      weekday: definition.weekday,
      time: definition.startTime,
      windowStart: scheduleWindowStart,
      windowEnd: scheduleWindowEnd,
    });

    for (const startsAt of startsAtList) {
      await upsertStudioSession({
        classTemplateId: definition.template.id,
        recurringRuleId: recurringRule.id,
        classTypeId: definition.classType.id,
        teacherId,
        title: definition.template.title,
        description: definition.template.description ?? undefined,
        location: definition.template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + definition.template.defaultDurationMinutes * 60 * 1000),
        capacity: definition.template.defaultCapacity,
      });
    }
  }
}

async function seedLearningFromJson() {
  const learningJsonPath = resolve(
    process.env.LEARNING_SEED_JSON_PATH?.trim() || DEFAULT_LEARNING_SEED_JSON_PATH,
  );
  const raw = await readFile(learningJsonPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Learning seed JSON is invalid: ${learningJsonPath}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Learning seed JSON root must be an object: ${learningJsonPath}`);
  }

  const courseRecordsRaw = parsed.courses;
  if (!Array.isArray(courseRecordsRaw) || courseRecordsRaw.length === 0) {
    throw new Error(`Learning seed JSON must contain a non-empty 'courses' array: ${learningJsonPath}`);
  }

  const courseInputs: LearningCourseSeedInput[] = [];
  for (const [index, item] of courseRecordsRaw.entries()) {
    if (!isRecord(item)) {
      throw new Error(`courses[${index}] must be an object in ${learningJsonPath}`);
    }

    const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
    const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));
    const category = asRequiredString(pickFirstDefined(item, ["category", "Category"]));

    if (!legacyId || !title || !category) {
      throw new Error(
        `courses[${index}] is missing required fields (ID/Title/Category) in ${learningJsonPath}`,
      );
    }

    const priority = asOptionalNumber(pickFirstDefined(item, ["priority", "Priority"])) ?? index + 1;
    courseInputs.push({
      legacyId,
      title,
      description: asOptionalString(pickFirstDefined(item, ["description", "Description"])),
      shortDescription: asOptionalString(
        pickFirstDefined(item, ["shortDescription", "Short Description"]),
      ),
      category,
      categoryType: asOptionalString(
        pickFirstDefined(item, ["categoryType", "Category Type"]),
      ),
      categoryLevel: asOptionalString(
        pickFirstDefined(item, ["categoryLevel", "Category Level"]),
      ),
      thumbnail: asOptionalString(pickFirstDefined(item, ["thumbnail", "Thumbnail"])),
      videoUrl: asOptionalString(pickFirstDefined(item, ["videoUrl", "VideoURL"])),
      priority,
    });
  }

  const programInputs: LearningProgramSeedInput[] = [];
  if (Array.isArray(parsed.programs) && parsed.programs.length > 0) {
    for (const [index, item] of parsed.programs.entries()) {
      if (!isRecord(item)) {
        throw new Error(`programs[${index}] must be an object in ${learningJsonPath}`);
      }

      const legacyId = asRequiredId(pickFirstDefined(item, ["legacyId", "ID"]));
      const mainTitle = asRequiredString(pickFirstDefined(item, ["mainTitle", "MainTitle"]));
      const courseType = asRequiredString(pickFirstDefined(item, ["courseType", "CourseType"]));
      const title = asRequiredString(pickFirstDefined(item, ["title", "Title"]));
      if (!legacyId || !mainTitle || !courseType || !title) {
        throw new Error(
          `programs[${index}] is missing required fields (ID/MainTitle/CourseType/Title) in ${learningJsonPath}`,
        );
      }

      programInputs.push({
        legacyId,
        mainTitle,
        mainDescription: asOptionalString(
          pickFirstDefined(item, ["mainDescription", "MainDescription"]),
        ),
        courseType,
        title,
        description1: asOptionalString(pickFirstDefined(item, ["description1", "Description1"])),
        description2: asOptionalString(pickFirstDefined(item, ["description2", "Description2"])),
        description3: asOptionalString(pickFirstDefined(item, ["description3", "Description3"])),
        videoPromo: asOptionalString(pickFirstDefined(item, ["videoPromo", "VideoPromo"])),
        picture1: asOptionalString(pickFirstDefined(item, ["picture1", "Picture1"])),
        picture2: asOptionalString(pickFirstDefined(item, ["picture2", "Picture2"])),
        picture3: asOptionalString(pickFirstDefined(item, ["picture3", "Picture3"])),
      });
    }
  } else {
    const seedByCategory = new Map<
      string,
      { summary?: string; thumbnail?: string; videoUrl?: string }
    >();
    for (const course of courseInputs) {
      if (seedByCategory.has(course.category)) {
        continue;
      }

      seedByCategory.set(course.category, {
        summary: course.shortDescription ?? course.description,
        thumbnail: course.thumbnail,
        videoUrl: course.videoUrl,
      });
    }

    for (const [category, seed] of seedByCategory.entries()) {
      const suffix = slugifyForLegacyId(category);
      programInputs.push({
        legacyId: `program-${suffix}`,
        mainTitle: category,
        mainDescription: seed.summary,
        courseType: category,
        title: category,
        description1: seed.summary,
        description2: undefined,
        description3: undefined,
        videoPromo: seed.videoUrl,
        picture1: seed.thumbnail,
        picture2: seed.thumbnail,
        picture3: seed.thumbnail,
      });
    }
  }

  const programByCourseType = new Set(programInputs.map((program) => program.courseType));
  const coursesWithoutProgram = courseInputs
    .filter((course) => !programByCourseType.has(course.category))
    .map((course) => course.category);
  if (coursesWithoutProgram.length > 0) {
    throw new Error(
      `Learning seed JSON has courses mapped to unknown categories/courseType values: ${[
        ...new Set(coursesWithoutProgram),
      ].join(", ")}`,
    );
  }

  for (const program of programInputs) {
    await prisma.learningProgram.upsert({
      where: { legacyId: program.legacyId },
      update: {
        mainTitle: program.mainTitle,
        mainDescription: program.mainDescription,
        courseType: program.courseType,
        title: program.title,
        description1: program.description1,
        description2: program.description2,
        description3: program.description3,
        videoPromo: program.videoPromo,
        picture1: program.picture1,
        picture2: program.picture2,
        picture3: program.picture3,
      },
      create: {
        legacyId: program.legacyId,
        mainTitle: program.mainTitle,
        mainDescription: program.mainDescription,
        courseType: program.courseType,
        title: program.title,
        description1: program.description1,
        description2: program.description2,
        description3: program.description3,
        videoPromo: program.videoPromo,
        picture1: program.picture1,
        picture2: program.picture2,
        picture3: program.picture3,
      },
    });
  }

  for (const course of courseInputs) {
    await prisma.learningCourse.upsert({
      where: { legacyId: course.legacyId },
      update: {
        title: course.title,
        description: course.description,
        shortDescription: course.shortDescription,
        category: course.category,
        categoryType: course.categoryType,
        categoryLevel: course.categoryLevel,
        thumbnail: course.thumbnail,
        videoUrl: course.videoUrl,
        priority: course.priority,
      },
      create: {
        legacyId: course.legacyId,
        title: course.title,
        description: course.description,
        shortDescription: course.shortDescription,
        category: course.category,
        categoryType: course.categoryType,
        categoryLevel: course.categoryLevel,
        thumbnail: course.thumbnail,
        videoUrl: course.videoUrl,
        priority: course.priority,
      },
    });
  }

  await prisma.learningCourse.deleteMany({
    where: {
      legacyId: {
        notIn: courseInputs.map((course) => course.legacyId),
      },
    },
  });

  await prisma.learningProgram.deleteMany({
    where: {
      legacyId: {
        notIn: programInputs.map((program) => program.legacyId),
      },
    },
  });

  console.info(
    `[seed] Learning content seeded from JSON (${learningJsonPath}): programs=${programInputs.length}, courses=${courseInputs.length}.`,
  );
}

async function verifyCleanSeed(clientEmail: string) {
  const [userCount, productCount, sessionCount, cancelledSessionCount] = await prisma.$transaction([
    prisma.user.count(),
    prisma.product.count({ where: { isActive: true, isArchived: false } }),
    prisma.studioSession.count({
      where: { status: StudioSessionStatus.SCHEDULED, startsAt: { gte: new Date() } },
    }),
    prisma.studioSession.count({ where: { status: StudioSessionStatus.CANCELLED } }),
  ]);

  if (userCount !== 4) {
    throw new Error(`Seed verification failed: expected 4 users, got ${userCount}.`);
  }

  if (productCount !== 6) {
    throw new Error(`Seed verification failed: expected 6 active products, got ${productCount}.`);
  }

  if (sessionCount < 20) {
    throw new Error(`Seed verification failed: expected at least 20 future sessions, got ${sessionCount}.`);
  }

  if (cancelledSessionCount !== 0) {
    throw new Error(`Seed verification failed: expected 0 cancelled sessions, got ${cancelledSessionCount}.`);
  }

  const client = await prisma.user.findUnique({
    where: { email: clientEmail },
    select: {
      id: true,
      clientBookings: true,
      subscriptionContracts: true,
      clientEntitlements: true,
      creditLedgerEntries: true,
      clientLoyaltyLedgerEntries: true,
      orders: true,
    },
  });

  if (!client) {
    throw new Error("Seed verification failed: QA client missing.");
  }

  if (
    client.clientBookings.length !== 0 ||
    client.subscriptionContracts.length !== 0 ||
    client.clientEntitlements.length !== 0 ||
    client.creditLedgerEntries.length !== 0 ||
    client.clientLoyaltyLedgerEntries.length !== 0 ||
    client.orders.length !== 0
  ) {
    throw new Error("Seed verification failed: QA client is expected to have zero history and balances.");
  }

  const operationalCounts = await prisma.$transaction([
    prisma.booking.count(),
    prisma.waitlistEntry.count(),
    prisma.attendanceRecord.count(),
    prisma.order.count(),
    prisma.payment.count(),
    prisma.subscriptionContract.count(),
    prisma.clientEntitlement.count(),
    prisma.creditLedgerEntry.count(),
    prisma.loyaltyLedgerEntry.count(),
    prisma.adminNote.count(),
    prisma.auditLog.count(),
    prisma.contactMessage.count(),
  ]);

  if (operationalCounts.some((count) => count !== 0)) {
    throw new Error("Seed verification failed: operational history tables must be empty for clean QA seed.");
  }
}

async function main() {
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  await purgeForCleanSeed();
  const users = await seedUsers();
  await seedBookingPolicy();
  await seedCatalog(stripePriceIdByLookupKey);
  await seedScheduling(users.teacher.id);
  await seedLearningFromJson();
  await verifyCleanSeed(users.client.email);

  console.info("Clean QA-style seed completed.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
