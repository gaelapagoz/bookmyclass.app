import {
  BillingInterval,
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
  MarketingAudienceType,
  MarketingCampaignStatus,
  MarketingRecipientStatus,
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
  SubscriptionStatus,
  Weekday,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import prisma from "../src/lib/db";
import { assertLearningImagePath } from "../src/lib/learning/image-paths";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

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
const FUTURE_OCCUPANCY_FULL_RATIO = 0.01;

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

type SeededRng = {
  next: () => number;
  int: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
};

function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number) => {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) {
      return min;
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]) => {
    if (items.length === 0) {
      throw new Error("Seed RNG pick requires a non-empty array.");
    }
    return items[int(0, items.length - 1)]!;
  };

  const shuffle = <T>(items: readonly T[]) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const current = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = current;
    }
    return copy;
  };

  return { next, int, pick, shuffle };
}

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

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
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

  await prisma.clientProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.publicAuthRateLimit.deleteMany();
  await prisma.pendingUserRegistration.deleteMany();
  await prisma.user.deleteMany();
}

async function seedMarketingDemoData(input: { createdById: string }) {
  const announcementCategory = await prisma.marketingCategory.upsert({
    where: { slug: "announcement" },
    update: { name: "Announcement", isActive: true },
    create: {
      name: "Announcement",
      slug: "announcement",
      isActive: true,
    },
  });

  const promotionCategory = await prisma.marketingCategory.upsert({
    where: { slug: "promotion" },
    update: { name: "Promotion", isActive: true },
    create: {
      name: "Promotion",
      slug: "promotion",
      isActive: true,
    },
  });

  await prisma.marketingCategory.upsert({
    where: { slug: "newsletter" },
    update: { name: "Newsletter", isActive: true },
    create: {
      name: "Newsletter",
      slug: "newsletter",
      isActive: true,
    },
  });

  const draftCampaign = await prisma.marketingCampaign.upsert({
    where: { id: "seed-marketing-draft-campaign" },
    update: {
      name: "Beta Welcome Announcement Draft",
      status: MarketingCampaignStatus.DRAFT,
      categoryId: announcementCategory.id,
      audienceType: MarketingAudienceType.ALL_USERS,
      manualAudienceJson: { emails: [], userIds: [] },
      subject: "Welcome to our beta studio updates",
      previewText: "A quick look at what members can expect this month.",
      fromName: "BookMyClass Studio",
      fromEmail: "hello@bookmyclass.local",
      replyTo: "support@bookmyclass.local",
      contentJson: {
        blocks: [
          { type: "heading", text: "Welcome to BookMyClass Beta" },
          {
            type: "paragraph",
            text: "Thanks for joining us. This draft demonstrates the editor and delivery workflow.",
          },
          { type: "button", text: "View classes", url: "https://bookmyclass.local/book-a-class" },
        ],
      },
      htmlSnapshot: null,
      sentAt: null,
      createdById: input.createdById,
    },
    create: {
      id: "seed-marketing-draft-campaign",
      name: "Beta Welcome Announcement Draft",
      status: MarketingCampaignStatus.DRAFT,
      categoryId: announcementCategory.id,
      audienceType: MarketingAudienceType.ALL_USERS,
      manualAudienceJson: { emails: [], userIds: [] },
      subject: "Welcome to our beta studio updates",
      previewText: "A quick look at what members can expect this month.",
      fromName: "BookMyClass Studio",
      fromEmail: "hello@bookmyclass.local",
      replyTo: "support@bookmyclass.local",
      contentJson: {
        blocks: [
          { type: "heading", text: "Welcome to BookMyClass Beta" },
          {
            type: "paragraph",
            text: "Thanks for joining us. This draft demonstrates the editor and delivery workflow.",
          },
          { type: "button", text: "View classes", url: "https://bookmyclass.local/book-a-class" },
        ],
      },
      createdById: input.createdById,
    },
  });

  const sentCampaignSentAt = new Date("2026-03-25T10:00:00.000Z");
  const sentCampaign = await prisma.marketingCampaign.upsert({
    where: { id: "seed-marketing-sent-campaign" },
    update: {
      name: "Spring Studio Promotion",
      status: MarketingCampaignStatus.SENT,
      categoryId: promotionCategory.id,
      audienceType: MarketingAudienceType.PAYING_SUBSCRIBERS,
      manualAudienceJson: { emails: [], userIds: [] },
      subject: "Spring promo: extra classes this week",
      previewText: "Members get bonus class access while spots last.",
      fromName: "BookMyClass Studio",
      fromEmail: "offers@bookmyclass.local",
      replyTo: "support@bookmyclass.local",
      contentJson: {
        blocks: [
          { type: "heading", text: "Spring Promo Is Live" },
          {
            type: "paragraph",
            text: "Book this week's classes early and get access to bonus member-only sessions.",
          },
          { type: "button", text: "Claim your spot", url: "https://bookmyclass.local/dashboard/bookings" },
          { type: "button", text: "View plans", url: "https://bookmyclass.local/subscription" },
        ],
      },
      htmlSnapshot:
        "<html><body><h2>Spring Promo Is Live</h2><p>Members get bonus sessions this week.</p></body></html>",
      sentAt: sentCampaignSentAt,
      createdById: input.createdById,
    },
    create: {
      id: "seed-marketing-sent-campaign",
      name: "Spring Studio Promotion",
      status: MarketingCampaignStatus.SENT,
      categoryId: promotionCategory.id,
      audienceType: MarketingAudienceType.PAYING_SUBSCRIBERS,
      manualAudienceJson: { emails: [], userIds: [] },
      subject: "Spring promo: extra classes this week",
      previewText: "Members get bonus class access while spots last.",
      fromName: "BookMyClass Studio",
      fromEmail: "offers@bookmyclass.local",
      replyTo: "support@bookmyclass.local",
      contentJson: {
        blocks: [
          { type: "heading", text: "Spring Promo Is Live" },
          {
            type: "paragraph",
            text: "Book this week's classes early and get access to bonus member-only sessions.",
          },
          { type: "button", text: "Claim your spot", url: "https://bookmyclass.local/dashboard/bookings" },
          { type: "button", text: "View plans", url: "https://bookmyclass.local/subscription" },
        ],
      },
      htmlSnapshot:
        "<html><body><h2>Spring Promo Is Live</h2><p>Members get bonus sessions this week.</p></body></html>",
      sentAt: sentCampaignSentAt,
      createdById: input.createdById,
    },
  });

  const recipientFixtures: Array<{
    id: string;
    email: string;
    status: MarketingRecipientStatus;
    sentAt: Date | null;
    deliveredAt: Date | null;
    openedAt: Date | null;
    clickedAt: Date | null;
    unsubscribedAt: Date | null;
  }> = [
    {
      id: "seed-mkt-recipient-01",
      email: "alice.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:01:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:01:20.000Z"),
      openedAt: new Date("2026-03-25T10:10:00.000Z"),
      clickedAt: new Date("2026-03-25T10:12:00.000Z"),
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-02",
      email: "beatrice.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.SENT,
      sentAt: new Date("2026-03-25T10:02:00.000Z"),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-03",
      email: "celine.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:03:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:03:10.000Z"),
      openedAt: new Date("2026-03-25T10:14:00.000Z"),
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-04",
      email: "diana.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.BOUNCED,
      sentAt: new Date("2026-03-25T10:04:00.000Z"),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-05",
      email: "eva.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:05:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:05:12.000Z"),
      openedAt: new Date("2026-03-25T10:20:00.000Z"),
      clickedAt: new Date("2026-03-25T10:24:00.000Z"),
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-06",
      email: "fatima.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.FAILED,
      sentAt: null,
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-07",
      email: "grace.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:06:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:06:14.000Z"),
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-08",
      email: "hana.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.SENT,
      sentAt: new Date("2026-03-25T10:07:00.000Z"),
      deliveredAt: null,
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
    {
      id: "seed-mkt-recipient-09",
      email: "ines.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:08:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:08:16.000Z"),
      openedAt: new Date("2026-03-25T10:18:00.000Z"),
      clickedAt: new Date("2026-03-25T10:31:00.000Z"),
      unsubscribedAt: new Date("2026-03-25T10:40:00.000Z"),
    },
    {
      id: "seed-mkt-recipient-10",
      email: "jade.seed+marketing@bookmyclass.local",
      status: MarketingRecipientStatus.DELIVERED,
      sentAt: new Date("2026-03-25T10:09:00.000Z"),
      deliveredAt: new Date("2026-03-25T10:09:14.000Z"),
      openedAt: null,
      clickedAt: null,
      unsubscribedAt: null,
    },
  ];

  for (const recipient of recipientFixtures) {
    await prisma.marketingCampaignRecipient.upsert({
      where: { id: recipient.id },
      update: {
        campaignId: sentCampaign.id,
        userId: null,
        email: recipient.email,
        status: recipient.status,
        sentAt: recipient.sentAt,
        deliveredAt: recipient.deliveredAt,
        openedAt: recipient.openedAt,
        clickedAt: recipient.clickedAt,
        unsubscribedAt: recipient.unsubscribedAt,
      },
      create: {
        id: recipient.id,
        campaignId: sentCampaign.id,
        userId: null,
        email: recipient.email,
        status: recipient.status,
        sentAt: recipient.sentAt,
        deliveredAt: recipient.deliveredAt,
        openedAt: recipient.openedAt,
        clickedAt: recipient.clickedAt,
        unsubscribedAt: recipient.unsubscribedAt,
      },
    });
  }

  const firstLink = await prisma.marketingCampaignLink.upsert({
    where: { token: "seed-mkt-link-bookings" },
    update: {
      campaignId: sentCampaign.id,
      url: "https://bookmyclass.local/dashboard/bookings",
      clickCount: 0,
    },
    create: {
      campaignId: sentCampaign.id,
      url: "https://bookmyclass.local/dashboard/bookings",
      token: "seed-mkt-link-bookings",
      clickCount: 0,
    },
  });

  const secondLink = await prisma.marketingCampaignLink.upsert({
    where: { token: "seed-mkt-link-subscription" },
    update: {
      campaignId: sentCampaign.id,
      url: "https://bookmyclass.local/subscription",
      clickCount: 0,
    },
    create: {
      campaignId: sentCampaign.id,
      url: "https://bookmyclass.local/subscription",
      token: "seed-mkt-link-subscription",
      clickCount: 0,
    },
  });

  const recipientsById = new Map(
    (
      await prisma.marketingCampaignRecipient.findMany({
        where: { campaignId: sentCampaign.id },
        select: { id: true, email: true },
      })
    ).map((recipient) => [recipient.id, recipient]),
  );

  const clickFixtures: Array<{
    id: string;
    linkId: string;
    recipientId: string;
    clickedAt: Date;
  }> = [
    {
      id: "seed-mkt-click-01",
      linkId: firstLink.id,
      recipientId: "seed-mkt-recipient-01",
      clickedAt: new Date("2026-03-25T10:12:00.000Z"),
    },
    {
      id: "seed-mkt-click-02",
      linkId: firstLink.id,
      recipientId: "seed-mkt-recipient-05",
      clickedAt: new Date("2026-03-25T10:24:00.000Z"),
    },
    {
      id: "seed-mkt-click-03",
      linkId: secondLink.id,
      recipientId: "seed-mkt-recipient-09",
      clickedAt: new Date("2026-03-25T10:31:00.000Z"),
    },
    {
      id: "seed-mkt-click-04",
      linkId: secondLink.id,
      recipientId: "seed-mkt-recipient-01",
      clickedAt: new Date("2026-03-25T10:33:00.000Z"),
    },
  ];

  for (const click of clickFixtures) {
    if (!recipientsById.has(click.recipientId)) {
      continue;
    }

    await prisma.marketingCampaignLinkClick.upsert({
      where: { id: click.id },
      update: {
        campaignLinkId: click.linkId,
        recipientId: click.recipientId,
        clickedAt: click.clickedAt,
        ip: "127.0.0.1",
        userAgent: "seed-agent",
      },
      create: {
        id: click.id,
        campaignLinkId: click.linkId,
        recipientId: click.recipientId,
        clickedAt: click.clickedAt,
        ip: "127.0.0.1",
        userAgent: "seed-agent",
      },
    });
  }

  const firstLinkClickCount = await prisma.marketingCampaignLinkClick.count({
    where: { campaignLinkId: firstLink.id },
  });
  const secondLinkClickCount = await prisma.marketingCampaignLinkClick.count({
    where: { campaignLinkId: secondLink.id },
  });

  await prisma.marketingCampaignLink.update({
    where: { id: firstLink.id },
    data: { clickCount: firstLinkClickCount },
  });
  await prisma.marketingCampaignLink.update({
    where: { id: secondLink.id },
    data: { clickCount: secondLinkClickCount },
  });

  await prisma.marketingUnsubscribe.upsert({
    where: { email: "ines.seed+marketing@bookmyclass.local" },
    update: {
      userId: null,
      unsubscribedAt: new Date("2026-03-25T10:40:00.000Z"),
    },
    create: {
      email: "ines.seed+marketing@bookmyclass.local",
      userId: null,
      unsubscribedAt: new Date("2026-03-25T10:40:00.000Z"),
    },
  });

  console.info(
    `[seed] Marketing demo data ready (draft=${draftCampaign.id}, sent=${sentCampaign.id}, recipients=${recipientFixtures.length}).`,
  );
}

async function seedUsers() {
  const rng = createSeededRng(SEED_RANDOM_SEED + 11);
  const sharedPasswordHash = await hash("qwerty123456", 12);
  const sharedEmailVerifiedAt = new Date("2026-01-01T00:00:00.000Z");

  const masterAdmin = await prisma.user.create({
    data: {
      name: "Master Admin",
      firstName: "Master",
      lastName: "Admin",
      email: "masteradmin@yogapilatesfitness.local",
      role: Role.MASTER_ADMIN,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
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
      email: "admin@yogapilatesfitness.local",
      role: Role.ADMIN,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-19T11:00:00.000Z"),
    },
  });

  const ana = await prisma.user.create({
    data: {
      name: "Ana Ionescu",
      firstName: "Ana",
      lastName: "Ionescu",
      email: "ana.ionescu@yogapilatesfitness.local",
      role: Role.TEACHER,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/ana_instructor_bio.jpg",
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-18T09:30:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000001",
          bio: "Ana leads classes with a clear and progressive approach to technique, breath, and confidence in movement.",
          specialties: ["Yoga", "Pilates"],
          certifications: ["RYT-200"],
          hireDate: new Date("2023-09-01T00:00:00.000Z"),
        },
      },
    },
  });

  const elena = await prisma.user.create({
    data: {
      name: "Elena Moreau",
      firstName: "Elena",
      lastName: "Moreau",
      email: "elena.moreau@yogapilatesfitness.local",
      role: Role.TEACHER,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/elena_instructor_bio.jpg",
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-17T10:00:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000003",
          bio: "Elena brings a calm, precise teaching style focused on alignment, strength, and confidence in movement. Her classes are designed to help students feel stronger, more balanced, and more connected to their bodies.",
          specialties: ["Pilates", "Mobility"],
          certifications: ["Comprehensive Pilates"],
          hireDate: new Date("2024-02-15T00:00:00.000Z"),
        },
      },
    },
  });

  const sofia = await prisma.user.create({
    data: {
      name: "Sofia Van den Berg",
      firstName: "Sofia",
      lastName: "Van den Berg",
      email: "sofia.vandenberg@yogapilatesfitness.local",
      role: Role.TEACHER,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
      image: "/images/instructors/sofia_instructor_bio.jpg",
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-16T08:45:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000004",
          bio: "Sofia teaches flowing classes with a warm and supportive approach. She focuses on breath, flexibility, and mindful movement, helping students build both ease and stability.",
          specialties: ["Yoga", "Stretch"],
          certifications: ["RYT-500"],
          hireDate: new Date("2024-05-01T00:00:00.000Z"),
        },
      },
    },
  });

  const client = await prisma.user.create({
    data: {
      name: "Client User",
      firstName: "Client",
      lastName: "User",
      email: "client@yogapilatesfitness.local",
      role: Role.CLIENT,
      passwordHash: sharedPasswordHash,
      emailVerified: sharedEmailVerifiedAt,
      emailVerifiedAt: sharedEmailVerifiedAt,
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

  const firstNames = [
    "Lucas",
    "Emma",
    "Noah",
    "Olivia",
    "Liam",
    "Mila",
    "Ethan",
    "Sofia",
    "Ava",
    "Mason",
    "Ella",
    "Lena",
    "Leo",
    "Chloe",
    "Nora",
    "Aiden",
    "Aria",
    "Zoe",
    "Mia",
    "Luca",
    "Amelia",
    "Theo",
    "Camille",
    "Jules",
    "Nina",
    "Ines",
    "Amir",
    "Hana",
    "Mateo",
    "Lea",
    "Sam",
    "Marta",
    "Yara",
    "Elise",
    "Maya",
    "Iris",
    "Dalia",
    "Anouk",
    "Lina",
    "Sarah",
  ] as const;
  const lastNames = [
    "De Smet",
    "Peeters",
    "Dubois",
    "Martin",
    "Lefevre",
    "Dupont",
    "Lambert",
    "Moreau",
    "Leroy",
    "Legrand",
    "Simon",
    "Michel",
    "Garcia",
    "Bernard",
    "Van den Broeck",
    "Vermeulen",
    "Rousseau",
    "Masson",
    "Bakker",
    "Jacobs",
    "Remy",
    "Charpentier",
    "Dumont",
    "Vidal",
    "Perez",
    "Kowalski",
    "Novak",
    "Fernandez",
    "Costa",
    "Meyer",
  ] as const;

  const slugifyNamePart = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "");

  const candidateNames: Array<{ firstName: string; lastName: string }> = [];
  for (const firstName of firstNames) {
    for (const lastName of lastNames) {
      candidateNames.push({ firstName, lastName });
    }
  }

  const extraClientsNeeded = SEED_CLIENT_COUNT - 1;
  if (extraClientsNeeded < 0) {
    throw new Error(`SEED_CLIENT_COUNT must be at least 1, received ${SEED_CLIENT_COUNT}.`);
  }
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
        name: fullName,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        email,
        role: Role.CLIENT,
        passwordHash: sharedPasswordHash,
        emailVerified: verifiedAt,
        emailVerifiedAt: verifiedAt,
        isActive: true,
        isInactive: false,
        lastLoginAt,
        clientProfile: {
          create: {
            phone: `+3201${String(index + 1).padStart(8, "0")}`,
            notes: "Seeded deterministic demo client profile.",
          },
        },
      },
    });
  }

  return {
    masterAdmin,
    admin,
    teachers: { ana, elena, sofia },
    client,
  };
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
  const hasStripePriceId = Boolean(input.stripePriceId?.trim());
  const stripeSyncStatus = hasStripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING;
  const stripeSyncLastAttempt = hasStripePriceId ? new Date() : null;
  const stripeSyncLastSuccess = hasStripePriceId ? new Date() : null;

  return prisma.price.upsert({
    where: { lookupKey: input.lookupKey },
    update: {
      productId: input.productId,
      name: input.name,
      stripePriceId: input.stripePriceId,
      stripeSyncStatus,
      stripeSyncLastAttempt,
      stripeSyncLastSuccess,
      stripeSyncErrorCode: null,
      stripeSyncError: null,
      stripeSyncCorrelation: null,
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
      stripeSyncStatus,
      stripeSyncLastAttempt,
      stripeSyncLastSuccess,
      stripeSyncErrorCode: null,
      stripeSyncError: null,
      stripeSyncCorrelation: null,
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
      stripeSyncStatus: true,
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

  const nonSyncedRows = seededPrices
    .filter((price) => price.stripeSyncStatus !== StripeSyncStatus.SYNCED)
    .map((price) => `${price.lookupKey}:${price.stripeSyncStatus}`);
  if (nonSyncedRows.length > 0) {
    throw new Error(
      "Seed verification failed: expected purchasable catalog prices to be SYNCED, got: " +
        nonSyncedRows.join(", "),
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

async function seedScheduling(teachers: { anaId: string; elenaId: string; sofiaId: string }) {
  const rng = createSeededRng(SEED_RANDOM_SEED + 97);

  type UsageTier = "HEAVY" | "MODERATE" | "LIGHT" | "RETURNING" | "INACTIVE";
  type OwnershipState =
    | "NO_PURCHASE"
    | "EXPIRED_ONLY"
    | "ACTIVE_DROP_IN"
    | "ACTIVE_5_PACK"
    | "ACTIVE_10_PACK"
    | "ACTIVE_MONTHLY"
    | "PRIVATE_ONLY";
  type CollectiveSessionSeed = {
    id: string;
    startsAt: Date;
    capacity: number;
    classTypeId: string;
    isFuture: boolean;
    occupancyTarget: number;
  };
  type SeedEntitlementState = {
    id: string;
    orderId: string;
    priceId: string;
    clientId: string;
    entitlementScope: EntitlementScope;
    activatedAt: Date;
    expiresAt: Date | null;
    unlimitedAccess: boolean;
    creditsRemaining: number;
  };
  type PurchaseLookupKey =
    | "collective-drop-in-eur-once-v1"
    | "qa-collective-5-pack-eur-once-v1"
    | "collective-10-pack-eur-once-v1"
    | "monthly-unlimited-collective-eur-monthly-v1"
    | "qa-private-5-pack-eur-once-v1";

  const ownershipCounts: Record<OwnershipState, number> = {
    NO_PURCHASE: 24,
    EXPIRED_ONLY: 24,
    ACTIVE_DROP_IN: 15,
    ACTIVE_5_PACK: 27,
    ACTIVE_10_PACK: 24,
    ACTIVE_MONTHLY: 30,
    PRIVATE_ONLY: 6,
  };
  const usageRatios: Record<UsageTier, number> = {
    HEAVY: HEAVY_CLIENT_RATIO,
    MODERATE: MODERATE_CLIENT_RATIO,
    LIGHT: LIGHT_CLIENT_RATIO,
    RETURNING: RETURNING_CLIENT_RATIO,
    INACTIVE: 1 - HEAVY_CLIENT_RATIO - MODERATE_CLIENT_RATIO - LIGHT_CLIENT_RATIO - RETURNING_CLIENT_RATIO,
  };

  const addDaysUtc = (value: Date, days: number) => {
    const next = new Date(value);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  };
  const addMonthsUtc = (value: Date, months: number) => {
    const next = new Date(value);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
  };
  const startOfUtcDay = (value: Date) => {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  };
  const endOfUtcDay = (value: Date) => {
    const date = new Date(value);
    date.setUTCHours(23, 59, 59, 999);
    return date;
  };

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
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const rocketYoga = await upsertClassType({
    slug: "rocket-yoga",
    categoryId: yogaCategory.id,
    name: "Rocket Yoga",
    description: "High-energy yoga sequencing with progressive options.",
    imageUrl: "/images/classes/rocket-yoga.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 20,
  });
  const hathaYoga = await upsertClassType({
    slug: "hatha-yoga",
    categoryId: yogaCategory.id,
    name: "Hatha Yoga",
    description: "Slower paced foundational yoga and alignment practice.",
    imageUrl: "/images/classes/hatha-yoga.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 30,
  });
  const matPilates = await upsertClassType({
    slug: "mat-pilates",
    categoryId: pilatesCategory.id,
    name: "Mat Pilates",
    description: "Core-driven pilates session suitable for all levels.",
    imageUrl: "/images/classes/mat-pilates.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const reformerFoundations = await upsertClassType({
    slug: "reformer-foundations",
    categoryId: pilatesCategory.id,
    name: "Reformer Foundations",
    description: "Small group reformer fundamentals for technique and control.",
    imageUrl: "/images/classes/reformer-foundations.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.PLAN_ONLY,
    sortOrder: 20,
  });
  const functionalStrength = await upsertClassType({
    slug: "functional-strength",
    categoryId: fitnessCategory.id,
    name: "Functional Strength",
    description: "Strength and conditioning with athletic movement patterns.",
    imageUrl: "/images/classes/functional-strength.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 10,
  });
  const privateReformerCoaching = await upsertClassType({
    slug: "private-reformer-coaching",
    categoryId: privateCategory.id,
    name: "Private Reformer Coaching",
    description: "Private 1:1 or duo coaching on the reformer.",
    imageUrl: "/images/classes/private-reformer-coaching.jpg",
    defaultDurationMinutes: 30,
    defaultCapacity: 1,
    pricingMode: ServicePricingMode.PLAN_ONLY,
    sortOrder: 10,
  });

  const vinyasaTemplate = await upsertClassTemplate({
    slug: "vinyasa-flow-brussels",
    classTypeId: vinyasaYoga.id,
    defaultTeacherId: teachers.anaId,
    title: "Vinyasa Flow Brussels",
    description: "A full-spectrum vinyasa class with warm-up, flow and cooldown.",
    location: "Ixelles Studio A",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  const rocketTemplate = await upsertClassTemplate({
    slug: "rocket-yoga-power-sequence",
    classTypeId: rocketYoga.id,
    defaultTeacherId: teachers.sofiaId,
    title: "Rocket Yoga Power Sequence",
    description: "Progressive rocket yoga with core and inversion prep.",
    location: "Ixelles Studio B",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  const hathaTemplate = await upsertClassTemplate({
    slug: "hatha-reset-weekend",
    classTypeId: hathaYoga.id,
    defaultTeacherId: teachers.anaId,
    title: "Hatha Reset Weekend",
    description: "Grounding hatha class focused on breath and posture quality.",
    location: "Ixelles Studio A",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  const matPilatesTemplate = await upsertClassTemplate({
    slug: "mat-pilates-core-lab",
    classTypeId: matPilates.id,
    defaultTeacherId: teachers.elenaId,
    title: "Mat Pilates Core Lab",
    description: "Core and glute-focused mat pilates with progression options.",
    location: "Etterbeek Studio C",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  const reformerTemplate = await upsertClassTemplate({
    slug: "reformer-foundations-small-group",
    classTypeId: reformerFoundations.id,
    defaultTeacherId: teachers.elenaId,
    title: "Reformer Foundations Small Group",
    description: "Technique-first reformer foundations for beginners.",
    location: "Ixelles Reformer Room",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  const functionalTemplate = await upsertClassTemplate({
    slug: "functional-strength-express",
    classTypeId: functionalStrength.id,
    defaultTeacherId: teachers.sofiaId,
    title: "Functional Strength Express",
    description: "High-focus functional strength class with mobility warm-up.",
    location: "Etterbeek Performance Room",
    defaultCapacity: COLLECTIVE_SESSION_CAPACITY,
    defaultDurationMinutes: 30,
  });
  await upsertClassTemplate({
    slug: "private-reformer-coaching-slot",
    classTypeId: privateReformerCoaching.id,
    defaultTeacherId: teachers.anaId,
    title: "Private Reformer Coaching",
    description: "Private coaching slot tailored to goals and mobility.",
    location: "Ixelles Private Studio",
    defaultCapacity: 1,
    defaultDurationMinutes: 30,
  });

  const clients = await prisma.user.findMany({
    where: {
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
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
  const pastSessionTimePool = [
    { hour: 7, minute: 0 },
    { hour: 8, minute: 30 },
    { hour: 12, minute: 0 },
    { hour: 16, minute: 30 },
    { hour: 18, minute: 0 },
    { hour: 19, minute: 30 },
  ] as const;
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
      if (startsAt < pastWindowStartUtc || startsAt > pastWindowEndUtc) {
        continue;
      }

      const def = collectiveRotation[(pastWeekIndex * 3 + slotInWeek) % collectiveRotation.length]!;
      const session = await upsertStudioSession({
        classTemplateId: def.template.id,
        classTypeId: def.classTypeId,
        teacherId: def.teacherId,
        title: def.template.title,
        description: def.template.description ?? undefined,
        location: def.template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        capacity: COLLECTIVE_SESSION_CAPACITY,
      });
      await prisma.studioSession.update({
        where: { id: session.id },
        data: { status: StudioSessionStatus.COMPLETED },
      });
      const occupancyScore = rng.next();
      const occupancyTarget =
        occupancyScore < 0.25 ? rng.int(2, 5) : occupancyScore < 0.75 ? rng.int(6, 11) : rng.int(12, 14);
      collectiveSessions.push({
        id: session.id,
        startsAt,
        capacity: COLLECTIVE_SESSION_CAPACITY,
        classTypeId: def.classTypeId,
        isFuture: false,
        occupancyTarget,
      });
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
      startsAt.setUTCHours(
        futureSlotStartHour + Math.floor(slotIndex / 2),
        slotIndex % 2 === 0 ? 0 : 30,
        0,
        0,
      );
      const def = collectiveRotation[(dayOffset * futureSlotsPerDay + slotIndex) % collectiveRotation.length]!;
      const occupancyScore = rng.next();
      let occupancyTarget = 0;
      if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO) {
        occupancyTarget = rng.int(1, 4);
      } else if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO + FUTURE_OCCUPANCY_MEDIUM_RATIO) {
        occupancyTarget = rng.int(5, 9);
      } else if (occupancyScore < FUTURE_OCCUPANCY_LOW_RATIO + FUTURE_OCCUPANCY_MEDIUM_RATIO + FUTURE_OCCUPANCY_HIGH_RATIO) {
        occupancyTarget = rng.int(10, 12);
      } else if (
        occupancyScore <
        FUTURE_OCCUPANCY_LOW_RATIO +
          FUTURE_OCCUPANCY_MEDIUM_RATIO +
          FUTURE_OCCUPANCY_HIGH_RATIO +
          FUTURE_OCCUPANCY_NEAR_FULL_RATIO
      ) {
        occupancyTarget = rng.int(13, 14);
      } else {
        occupancyTarget = COLLECTIVE_SESSION_CAPACITY;
      }

      const session = await upsertStudioSession({
        classTemplateId: def.template.id,
        classTypeId: def.classTypeId,
        teacherId: def.teacherId,
        title: def.template.title,
        description: def.template.description ?? undefined,
        location: def.template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
        capacity: COLLECTIVE_SESSION_CAPACITY,
      });
      collectiveSessions.push({
        id: session.id,
        startsAt,
        capacity: COLLECTIVE_SESSION_CAPACITY,
        classTypeId: def.classTypeId,
        isFuture: true,
        occupancyTarget,
      });
    }
  }

  const catalogPrices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: [
          "collective-drop-in-eur-once-v1",
          "qa-collective-5-pack-eur-once-v1",
          "collective-10-pack-eur-once-v1",
          "monthly-unlimited-collective-eur-monthly-v1",
          "qa-private-5-pack-eur-once-v1",
        ],
      },
      isActive: true,
      isArchived: false,
    },
    include: { product: true },
  });
  const priceByLookup = new Map(catalogPrices.map((price) => [price.lookupKey, price]));
  const entitlementRules = await prisma.entitlementRule.findMany({
    where: { productId: { in: catalogPrices.map((price) => price.productId) }, isActive: true },
  });
  const entitlementRuleByProductId = new Map(entitlementRules.map((rule) => [rule.productId, rule]));
  const requiredLookupKeys: PurchaseLookupKey[] = [
    "collective-drop-in-eur-once-v1",
    "qa-collective-5-pack-eur-once-v1",
    "collective-10-pack-eur-once-v1",
    "monthly-unlimited-collective-eur-monthly-v1",
    "qa-private-5-pack-eur-once-v1",
  ];
  for (const lookupKey of requiredLookupKeys) {
    if (!priceByLookup.get(lookupKey)) {
      throw new Error(`Scheduling seed missing required catalog price ${lookupKey}.`);
    }
  }

  const ownershipOrder: OwnershipState[] = [
    "NO_PURCHASE",
    "EXPIRED_ONLY",
    "ACTIVE_DROP_IN",
    "ACTIVE_5_PACK",
    "ACTIVE_10_PACK",
    "ACTIVE_MONTHLY",
    "PRIVATE_ONLY",
  ];
  const ownershipPool: OwnershipState[] = [];
  for (const state of ownershipOrder) {
    for (let index = 0; index < ownershipCounts[state]; index += 1) {
      ownershipPool.push(state);
    }
  }
  if (ownershipPool.length !== clients.length) {
    throw new Error(`Ownership pool mismatch: ${ownershipPool.length} != ${clients.length}`);
  }
  const ownershipPlan = rng.shuffle(clients).map((client, index) => ({
    client,
    ownershipState: ownershipPool[index]!,
  }));

  const usageTiers: UsageTier[] = ["HEAVY", "MODERATE", "LIGHT", "RETURNING", "INACTIVE"];
  const usagePool: UsageTier[] = [];
  for (const tier of usageTiers) {
    const count = Math.floor(clients.length * usageRatios[tier]);
    for (let index = 0; index < count; index += 1) {
      usagePool.push(tier);
    }
  }
  while (usagePool.length < clients.length) {
    usagePool.push("LIGHT");
  }
  const usageByClientId = new Map<string, UsageTier>();
  const usageAssignmentOrder = rng.shuffle(ownershipPlan);
  for (let index = 0; index < clients.length; index += 1) {
    usageByClientId.set(usageAssignmentOrder[index]!.client.id, usagePool[index]!);
  }

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

  const createCommercialPurchase = async (input: {
    clientId: string;
    lookupKey: PurchaseLookupKey;
    purchasedAt: Date;
  }) => {
    const price = priceByLookup.get(input.lookupKey);
    if (!price) {
      throw new Error(`Missing price for ${input.lookupKey}.`);
    }
    const rule = entitlementRuleByProductId.get(price.productId);
    if (!rule) {
      throw new Error(`Missing entitlement rule for product ${price.productId}.`);
    }
    const totalAmountMinor = price.unitAmountMinor;
    const order = await prisma.order.create({
      data: {
        clientId: input.clientId,
        subtotalAmountMinor: totalAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor,
        currencyCode: price.currencyCode,
        status: OrderStatus.PAID,
        placedAt: input.purchasedAt,
        notes: `seed-commercial-${input.lookupKey}`,
      },
    });
    createdOrdersCount += 1;

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: price.productId,
        priceId: price.id,
        quantity: 1,
        productNameSnapshot: price.product.name,
        priceNameSnapshot: price.name,
        unitAmountMinor: totalAmountMinor,
        lineSubtotalAmountMinor: totalAmountMinor,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: totalAmountMinor,
        currencyCode: price.currencyCode,
      },
    });

    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: `seed-payment-${order.id}`,
        stripeCheckoutSessionId: `cs_test_seed_${order.id.slice(0, 20)}`,
        stripeCustomerId: `cus_seed_${input.clientId.slice(0, 12)}`,
        stripeCheckoutMode:
          price.priceType === PriceType.RECURRING ? StripeCheckoutMode.SUBSCRIPTION : StripeCheckoutMode.PAYMENT,
        amountMinor: totalAmountMinor,
        currencyCode: price.currencyCode,
        authorizedAt: input.purchasedAt,
        capturedAt: input.purchasedAt,
        createdAt: input.purchasedAt,
      },
    });
    createdPaymentsCount += 1;

    let expiresAt: Date | null = null;
    let subscriptionContractId: string | null = null;
    if (price.priceType === PriceType.RECURRING) {
      const intervalCount = price.billingIntervalCount ?? 1;
      expiresAt =
        price.billingInterval === BillingInterval.MONTH
          ? addMonthsUtc(input.purchasedAt, intervalCount)
          : addDaysUtc(input.purchasedAt, 30 * intervalCount);
      const contractStatus = expiresAt > seedDayUtc ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED;
      const contract = await prisma.subscriptionContract.create({
        data: {
          clientId: input.clientId,
          productId: price.productId,
          priceId: price.id,
          status: contractStatus,
          startsAt: input.purchasedAt,
          currentPeriodStart: input.purchasedAt,
          currentPeriodEnd: expiresAt,
          cancelAtPeriodEnd: contractStatus === SubscriptionStatus.EXPIRED,
          endedAt: contractStatus === SubscriptionStatus.EXPIRED ? expiresAt : null,
          provider: PaymentProvider.STRIPE,
          providerSubscriptionReference: `sub_seed_${order.id.slice(0, 20)}`,
        },
      });
      subscriptionContractId = contract.id;
      createdSubscriptionContractsCount += 1;
    } else if (rule.validForDays && rule.validForDays > 0) {
      expiresAt = addDaysUtc(input.purchasedAt, rule.validForDays);
    }

    const entitlementStatus =
      expiresAt && expiresAt <= endOfUtcDay(seedDayUtc)
        ? ClientEntitlementStatus.EXPIRED
        : ClientEntitlementStatus.ACTIVE;
    const entitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: input.clientId,
        productId: price.productId,
        orderId: order.id,
        subscriptionContractId,
        entitlementType: rule.entitlementType,
        entitlementScope: rule.entitlementScope,
        status: entitlementStatus,
        activatedAt: input.purchasedAt,
        expiresAt,
      },
    });
    createdEntitlementsCount += 1;

    let creditsGranted = 0;
    if (rule.entitlementType === EntitlementType.SINGLE_USE) {
      creditsGranted = 1;
    } else if (rule.entitlementType === EntitlementType.CREDIT_PACK) {
      creditsGranted = rule.quantity ?? 0;
    }
    if (creditsGranted > 0) {
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.clientId,
          entryType: CreditLedgerEntryType.GRANT,
          amount: creditsGranted,
          happenedAt: input.purchasedAt,
          entitlementId: entitlement.id,
          orderId: order.id,
          notes: `Seed entitlement grant (${input.lookupKey})`,
        },
      });
      createdCreditLedgerEntriesCount += 1;
    }

    pushEntitlement({
      id: entitlement.id,
      orderId: order.id,
      priceId: price.id,
      clientId: input.clientId,
      entitlementScope: rule.entitlementScope,
      activatedAt: input.purchasedAt,
      expiresAt,
      unlimitedAccess: rule.entitlementType === EntitlementType.UNLIMITED_ACCESS,
      creditsRemaining: creditsGranted,
    });
  };

  const purchaseDaysAgo = (minDays: number, maxDays: number) => rng.int(minDays, maxDays);
  for (const entry of ownershipPlan) {
    const clientId = entry.client.id;
    switch (entry.ownershipState) {
      case "NO_PURCHASE":
        break;
      case "EXPIRED_ONLY":
        await createCommercialPurchase({
          clientId,
          lookupKey: "qa-collective-5-pack-eur-once-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(95, 118)),
        });
        if (rng.next() < 0.35) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "collective-drop-in-eur-once-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 80)),
          });
        }
        break;
      case "ACTIVE_DROP_IN":
        await createCommercialPurchase({
          clientId,
          lookupKey: "collective-drop-in-eur-once-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(2, 21)),
        });
        if (rng.next() < 0.4) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "collective-drop-in-eur-once-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 90)),
          });
        }
        break;
      case "ACTIVE_5_PACK":
        await createCommercialPurchase({
          clientId,
          lookupKey: "qa-collective-5-pack-eur-once-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(1, 50)),
        });
        if (rng.next() < 0.55) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "qa-collective-5-pack-eur-once-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(55, 115)),
          });
        }
        break;
      case "ACTIVE_10_PACK":
        await createCommercialPurchase({
          clientId,
          lookupKey: "collective-10-pack-eur-once-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(1, 70)),
        });
        if (rng.next() < 0.4) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "qa-collective-5-pack-eur-once-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(75, 118)),
          });
        }
        break;
      case "ACTIVE_MONTHLY":
        await createCommercialPurchase({
          clientId,
          lookupKey: "monthly-unlimited-collective-eur-monthly-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(2, 22)),
        });
        if (rng.next() < 0.7) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "monthly-unlimited-collective-eur-monthly-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(35, 55)),
          });
        }
        if (rng.next() < 0.35) {
          await createCommercialPurchase({
            clientId,
            lookupKey: "qa-collective-5-pack-eur-once-v1",
            purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(60, 110)),
          });
        }
        break;
      case "PRIVATE_ONLY":
        await createCommercialPurchase({
          clientId,
          lookupKey: "qa-private-5-pack-eur-once-v1",
          purchasedAt: addDaysUtc(seedDayUtc, -purchaseDaysAgo(10, 90)),
        });
        break;
    }
  }

  const bookedPairs = new Set<string>();
  let createdPastBookingsCount = 0;
  let createdFutureBookingsCount = 0;
  const tierWeight: Record<UsageTier, number> = {
    HEAVY: 8,
    MODERATE: 5,
    LIGHT: 3,
    RETURNING: 2,
    INACTIVE: 0.2,
  };
  const recentlyActiveWindowStart = addDaysUtc(seedDayUtc, -21);

  const pickEntitlementForSession = (clientId: string, sessionStartsAt: Date) => {
    const entries = entitlementsByClient.get(clientId) ?? [];
    return entries.find((entry) => {
      if (entry.entitlementScope !== EntitlementScope.COLLECTIVE_CLASSES) {
        return false;
      }
      if (sessionStartsAt < entry.activatedAt) {
        return false;
      }
      if (entry.expiresAt && sessionStartsAt > entry.expiresAt) {
        return false;
      }
      return entry.unlimitedAccess || entry.creditsRemaining > 0;
    });
  };

  const ownershipStateByClientId = new Map(ownershipPlan.map((entry) => [entry.client.id, entry.ownershipState]));
  const chooseCandidatesForSession = (session: CollectiveSessionSeed) => {
    const candidates: Array<{ client: (typeof clients)[number]; weight: number }> = [];
    for (const client of clients) {
      const pairKey = `${client.id}::${session.id}`;
      if (bookedPairs.has(pairKey)) {
        continue;
      }
      const entitlement = pickEntitlementForSession(client.id, session.startsAt);
      if (!entitlement) {
        continue;
      }
      const usageTier = usageByClientId.get(client.id) ?? "LIGHT";
      if (usageTier === "INACTIVE" && session.startsAt >= addDaysUtc(seedDayUtc, -30)) {
        continue;
      }
      if (usageTier === "RETURNING" && session.startsAt > recentlyActiveWindowStart && session.startsAt < seedDayUtc) {
        continue;
      }
      if (ownershipStateByClientId.get(client.id) === "ACTIVE_DROP_IN" && session.isFuture && rng.next() < 0.85) {
        continue;
      }
      candidates.push({ client, weight: tierWeight[usageTier] ?? 1 });
    }
    return candidates;
  };

  const weightedPick = <T>(items: Array<{ value: T; weight: number }>) => {
    if (items.length === 0) {
      return null;
    }
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
      return null;
    }
    const target = rng.next() * totalWeight;
    let cursor = 0;
    for (const item of items) {
      cursor += item.weight;
      if (target <= cursor) {
        return item.value;
      }
    }
    return items[items.length - 1]!.value;
  };

  const createBookingFromEntitlement = async (input: {
    client: (typeof clients)[number];
    session: CollectiveSessionSeed;
    entitlement: SeedEntitlementState;
    status: BookingStatus;
    cancelledAt?: Date;
  }) => {
    const pairKey = `${input.client.id}::${input.session.id}`;
    if (bookedPairs.has(pairKey)) {
      return false;
    }
    const bookedAt = addDaysUtc(input.session.startsAt, -rng.int(1, 8));
    const cancellationEligibleUntilAt = addDaysUtc(input.session.startsAt, -1);
    cancellationEligibleUntilAt.setUTCHours(input.session.startsAt.getUTCHours(), input.session.startsAt.getUTCMinutes(), 0, 0);
    const booking = await prisma.booking.create({
      data: {
        clientId: input.client.id,
        studioSessionId: input.session.id,
        orderId: input.entitlement.orderId,
        status: input.status,
        bookingIntent: BookingIntent.USE_PLAN,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        selectedEntitlementId: input.entitlement.id,
        selectedPriceId: input.entitlement.priceId,
        bookedAt,
        customerName: input.client.name,
        customerEmail: input.client.email,
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: bookedAt,
        cancellationEligibleUntilAt,
        cancelledAt: input.cancelledAt ?? null,
        creditRefundedAt: input.status === BookingStatus.CANCELLED ? input.cancelledAt ?? bookedAt : null,
      },
    });
    bookedPairs.add(pairKey);

    if (!input.entitlement.unlimitedAccess) {
      input.entitlement.creditsRemaining -= 1;
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.client.id,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          happenedAt: bookedAt,
          entitlementId: input.entitlement.id,
          bookingId: booking.id,
          orderId: input.entitlement.orderId,
          notes: "Seed booking credit consumption",
        },
      });
      createdCreditLedgerEntriesCount += 1;
      if (input.status === BookingStatus.CANCELLED) {
        input.entitlement.creditsRemaining += 1;
        await prisma.creditLedgerEntry.create({
          data: {
            clientId: input.client.id,
            entryType: CreditLedgerEntryType.RESTORE,
            amount: 1,
            happenedAt: input.cancelledAt ?? bookedAt,
            entitlementId: input.entitlement.id,
            bookingId: booking.id,
            orderId: input.entitlement.orderId,
            notes: "Seed cancellation credit restore",
          },
        });
        createdCreditLedgerEntriesCount += 1;
      }
    }

    if (input.session.isFuture) {
      createdFutureBookingsCount += 1;
    } else {
      createdPastBookingsCount += 1;
    }
    return true;
  };

  collectiveSessions.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const session of collectiveSessions) {
    const sessionCandidates = chooseCandidatesForSession(session);
    let createdForSession = 0;
    let guard = 0;
    while (createdForSession < session.occupancyTarget && guard < 700) {
      guard += 1;
      const selectedClient = weightedPick(
        sessionCandidates.map((candidate) => ({ value: candidate.client, weight: candidate.weight })),
      );
      if (!selectedClient) {
        break;
      }
      const entitlement = pickEntitlementForSession(selectedClient.id, session.startsAt);
      if (!entitlement) {
        continue;
      }

      let status: BookingStatus = session.isFuture ? BookingStatus.CONFIRMED : BookingStatus.COMPLETED;
      let cancelledAt: Date | undefined;
      if (!session.isFuture) {
        const statusScore = rng.next();
        if (statusScore < 0.08) {
          status = BookingStatus.CANCELLED;
          cancelledAt = addDaysUtc(session.startsAt, -2);
        } else if (statusScore < 0.18) {
          status = BookingStatus.NO_SHOW;
        }
      }

      const created = await createBookingFromEntitlement({
        client: selectedClient,
        session,
        entitlement,
        status,
        cancelledAt,
      });
      if (!created) {
        continue;
      }
      createdForSession += 1;
    }
  }

  const countByOwnership = (state: OwnershipState) =>
    ownershipPlan.filter((entry) => entry.ownershipState === state).length;
  const pastSessionsCount = collectiveSessions.filter((session) => !session.isFuture).length;
  const futureSessions = collectiveSessions.filter((session) => session.isFuture);

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
    nearFullFutureSessionsCount: futureSessions.filter((session) => session.occupancyTarget >= 13).length,
    fullFutureSessionsCount: futureSessions.filter((session) => session.occupancyTarget >= COLLECTIVE_SESSION_CAPACITY).length,
    ownershipDistribution: {
      noPurchase: countByOwnership("NO_PURCHASE"),
      expiredOnly: countByOwnership("EXPIRED_ONLY"),
      activeDropIn: countByOwnership("ACTIVE_DROP_IN"),
      active5Pack: countByOwnership("ACTIVE_5_PACK"),
      active10Pack: countByOwnership("ACTIVE_10_PACK"),
      activeMonthly: countByOwnership("ACTIVE_MONTHLY"),
      privateOnly: countByOwnership("PRIVATE_ONLY"),
    },
  };
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
      thumbnail:
        assertLearningImagePath(
          asOptionalString(pickFirstDefined(item, ["thumbnail", "Thumbnail"])),
          `courses[${index}].thumbnail`,
        ) ?? undefined,
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
        picture1:
          assertLearningImagePath(
            asOptionalString(pickFirstDefined(item, ["picture1", "Picture1"])),
            `programs[${index}].picture1`,
          ) ?? undefined,
        picture2:
          assertLearningImagePath(
            asOptionalString(pickFirstDefined(item, ["picture2", "Picture2"])),
            `programs[${index}].picture2`,
          ) ?? undefined,
        picture3:
          assertLearningImagePath(
            asOptionalString(pickFirstDefined(item, ["picture3", "Picture3"])),
            `programs[${index}].picture3`,
          ) ?? undefined,
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

async function seedDashboardInsightsTraffic(seedClient: { id: string }) {
  const DASHBOARD_TREND_MARKER = "seed-demo-trend";
  const DASHBOARD_TREND_CUSTOMER_EMAIL = "seed-demo-trend@yogapilatesfitness.local";
  const teacherPasswordHash = await hash("qwerty123456", 12);
  const clientPasswordHash = await hash("qwerty123456", 12);
  const now = new Date();

  const staffByName = new Map<string, { id: string }>();
  for (const staff of [
    { name: "Orsi", email: "orsi@yogapilatesfitness.local", phone: "+32000001001" },
    { name: "Giulia Vago", email: "giulia.vago@yogapilatesfitness.local", phone: "+32000001002" },
    { name: "Elisa", email: "elisa@yogapilatesfitness.local", phone: "+32000001003" },
    { name: "Ourania", email: "ourania@yogapilatesfitness.local", phone: "+32000001004" },
  ] as const) {
    const record = await prisma.user.create({
      data: {
        name: staff.name,
        firstName: staff.name.split(" ")[0] ?? staff.name,
        lastName: staff.name.split(" ").slice(1).join(" ") || null,
        email: staff.email,
        role: Role.TEACHER,
        passwordHash: teacherPasswordHash,
        isActive: true,
        isInactive: false,
        teacherProfile: {
          create: {
            phone: staff.phone,
            bio: `${staff.name} supports beta scheduling operations.`,
            specialties: ["Yoga", "Pilates"],
            certifications: ["Studio Internal"],
            hireDate: new Date("2025-01-01T00:00:00.000Z"),
          },
        },
      },
      select: { id: true },
    });
    staffByName.set(staff.name, record);
  }

  const topClientNames = ["Katalin", "Maja Simunic", "Eline", "Batool Dodin", "Kriselda Deda"] as const;
  const atRiskNames = [
    "Engy Sawah",
    "Nela O",
    "Francesca",
    "Nolwenn Bertrand",
    "Svitlana Metelytsia",
  ] as const;
  const otherClientNames = [
    "Alice",
    "Beatrice",
    "Celine",
    "Diana",
    "Eva",
    "Fatima",
    "Grace",
    "Hana",
    "Ines",
    "Jade",
    "Kenza",
    "Lina",
    "Marta",
    "Nora",
    "Olivia",
  ] as const;
  const additionalNamedClients = ["Recovered Client", "Never Booked Client", "Cancelled Pattern Client"] as const;

  const clientRecords = new Map<string, { id: string }>();
  for (const name of [...topClientNames, ...atRiskNames, ...otherClientNames, ...additionalNamedClients]) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/(^\\.|\\.$)/g, "");
    const created = await prisma.user.create({
      data: {
        name,
        firstName: name.split(" ")[0] ?? name,
        lastName: name.split(" ").slice(1).join(" ") || null,
        email: `${slug}@yogapilatesfitness.local`,
        role: Role.CLIENT,
        passwordHash: clientPasswordHash,
        isActive: true,
        isInactive: false,
        clientProfile: {
          create: {
            phone: null,
            notes: "Seeded dashboard insights traffic client.",
          },
        },
      },
      select: { id: true },
    });
    clientRecords.set(name, created);
  }

  const yogaCategory = await upsertClassCategory({
    slug: "dashboard-seed-yoga",
    name: "Dashboard Seed Yoga",
    description: "Seed classes for dashboard insights.",
    sortOrder: 90,
  });
  const pilatesCategory = await upsertClassCategory({
    slug: "dashboard-seed-pilates",
    name: "Dashboard Seed Pilates",
    description: "Seed classes for dashboard insights.",
    sortOrder: 91,
  });
  const fitnessCategory = await upsertClassCategory({
    slug: "dashboard-seed-fitness",
    name: "Dashboard Seed Fitness",
    description: "Seed classes for dashboard insights.",
    sortOrder: 92,
  });

  const classDefinitions = [
    {
      key: "pilatesProps",
      className: "Pilates with Props",
      classSlug: "seed-pilates-with-props",
      templateSlug: "seed-template-pilates-with-props",
      categoryId: pilatesCategory.id,
      teacherName: "Orsi",
      capacity: 12,
      recentOffsets: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
      recentTargets: [11, 10, 10, 9, 9, 10, 11, 10, 9, 8, 10, 9],
      historicalOffsets: [34, 40, 46, 52, 58],
      futureOffsets: [2, 9, 16],
      hourUtc: 18,
    },
    {
      key: "rocket",
      className: "Rocket Yoga",
      classSlug: "seed-rocket-yoga",
      templateSlug: "seed-template-rocket-yoga",
      categoryId: yogaCategory.id,
      teacherName: "Orsi",
      capacity: 12,
      recentOffsets: [3, 5, 7, 9, 11, 13, 15, 17, 19, 21],
      recentTargets: [10, 9, 9, 8, 8, 9, 9, 8, 8, 7],
      historicalOffsets: [36, 43, 50, 57],
      futureOffsets: [3, 10, 17],
      hourUtc: 7,
    },
    {
      key: "vinyasa",
      className: "Vinyasa Yoga",
      classSlug: "seed-vinyasa-yoga",
      templateSlug: "seed-template-vinyasa-yoga",
      categoryId: yogaCategory.id,
      teacherName: "Giulia Vago",
      capacity: 10,
      recentOffsets: [2, 6, 10, 14, 18, 22, 26, 28],
      recentTargets: [7, 6, 6, 5, 6, 5, 6, 5],
      historicalOffsets: [35, 44, 53, 59],
      futureOffsets: [4, 11],
      hourUtc: 12,
    },
    {
      key: "trx",
      className: "Functional Training TRX",
      classSlug: "seed-functional-training-trx",
      templateSlug: "seed-template-functional-training-trx",
      categoryId: fitnessCategory.id,
      teacherName: "Giulia Vago",
      capacity: 10,
      recentOffsets: [4, 8, 12, 16, 20, 24, 28],
      recentTargets: [5, 4, 5, 4, 4, 5, 4],
      historicalOffsets: [33, 41, 49, 55],
      futureOffsets: [5, 12],
      hourUtc: 19,
    },
    {
      key: "stretch",
      className: "Stretch & Tone Pilates",
      classSlug: "seed-stretch-tone-pilates",
      templateSlug: "seed-template-stretch-tone-pilates",
      categoryId: pilatesCategory.id,
      teacherName: "Elisa",
      capacity: 8,
      recentOffsets: [5, 11, 17, 23, 29],
      recentTargets: [3, 2, 3, 2, 3],
      historicalOffsets: [37, 47, 54],
      futureOffsets: [6, 13],
      hourUtc: 17,
    },
    {
      key: "mobility",
      className: "Mobility Reset",
      classSlug: "seed-mobility-reset",
      templateSlug: "seed-template-mobility-reset",
      categoryId: fitnessCategory.id,
      teacherName: "Ourania",
      capacity: 10,
      recentOffsets: [7, 21],
      recentTargets: [1, 1],
      historicalOffsets: [45],
      futureOffsets: [8],
      hourUtc: 9,
    },
  ] as const;

  type SessionTarget = { sessionId: string; startsAt: Date; capacity: number; target: number };
  type EntitlementSeedState = {
    id: string;
    clientId: string;
    orderId: string;
    priceId: string;
    activatedAt: Date;
    expiresAt: Date | null;
    entitlementType: EntitlementType;
    entitlementScope: EntitlementScope;
    creditsRemaining: number;
    unlimitedAccess: boolean;
  };
  const recentSessionTargetsByClass = new Map<string, SessionTarget[]>();
  const historicalSessionsByClass = new Map<string, Array<{ sessionId: string; startsAt: Date; capacity: number }>>();

  function buildDate(offsetDays: number, hourUtc: number, isFuture: boolean) {
    const date = new Date();
    date.setUTCHours(hourUtc, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + (isFuture ? offsetDays : -offsetDays));
    return date;
  }

  function addDays(base: Date, days: number) {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }

  function addMonths(base: Date, months: number) {
    const next = new Date(base);
    next.setUTCMonth(next.getUTCMonth() + months);
    return next;
  }

  function startOfUtcDay(value: Date) {
    const date = new Date(value);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  function parseDashboardTrendAsOfDate(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error(`Invalid DASHBOARD_TREND_AS_OF_DATE value "${value}". Expected YYYY-MM-DD.`);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Invalid DASHBOARD_TREND_AS_OF_DATE value "${value}".`);
    }

    return parsed;
  }

  for (const definition of classDefinitions) {
    const classType = await upsertClassType({
      slug: definition.classSlug,
      categoryId: definition.categoryId,
      name: definition.className,
      description: `${definition.className} seed class for dashboard insights.`,
      imageUrl: undefined,
      defaultDurationMinutes: 60,
      defaultCapacity: definition.capacity,
      pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
      sortOrder: 100,
    });
    const template = await upsertClassTemplate({
      slug: definition.templateSlug,
      classTypeId: classType.id,
      defaultTeacherId: staffByName.get(definition.teacherName)!.id,
      title: definition.className,
      description: `${definition.className} dashboard insights seed template.`,
      location: "Ixelles Insights Studio",
      defaultCapacity: definition.capacity,
      defaultDurationMinutes: 60,
    });

    const recentTargets: SessionTarget[] = [];
    for (let index = 0; index < definition.recentOffsets.length; index += 1) {
      const startsAt = buildDate(definition.recentOffsets[index]!, definition.hourUtc, false);
      const session = await upsertStudioSession({
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: staffByName.get(definition.teacherName)!.id,
        title: definition.className,
        description: template.description ?? undefined,
        location: template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacity: definition.capacity,
      });
      await prisma.studioSession.update({
        where: { id: session.id },
        data: { status: StudioSessionStatus.COMPLETED },
      });
      recentTargets.push({
        sessionId: session.id,
        startsAt,
        capacity: definition.capacity,
        target: definition.recentTargets[index]!,
      });
    }
    recentSessionTargetsByClass.set(definition.key, recentTargets);

    const historicalSessions: Array<{ sessionId: string; startsAt: Date; capacity: number }> = [];
    for (const offset of definition.historicalOffsets) {
      const startsAt = buildDate(offset, definition.hourUtc, false);
      const session = await upsertStudioSession({
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: staffByName.get(definition.teacherName)!.id,
        title: definition.className,
        description: template.description ?? undefined,
        location: template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacity: definition.capacity,
      });
      await prisma.studioSession.update({
        where: { id: session.id },
        data: { status: StudioSessionStatus.COMPLETED },
      });
      historicalSessions.push({ sessionId: session.id, startsAt, capacity: definition.capacity });
    }
    historicalSessionsByClass.set(definition.key, historicalSessions);

    for (const offset of definition.futureOffsets) {
      const startsAt = buildDate(offset, definition.hourUtc, true);
      await upsertStudioSession({
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: staffByName.get(definition.teacherName)!.id,
        title: definition.className,
        description: template.description ?? undefined,
        location: template.location ?? undefined,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        capacity: definition.capacity,
      });
    }
  }

  const recentSessionTargets = [
    ...(recentSessionTargetsByClass.get("pilatesProps") ?? []),
    ...(recentSessionTargetsByClass.get("rocket") ?? []),
    ...(recentSessionTargetsByClass.get("vinyasa") ?? []),
    ...(recentSessionTargetsByClass.get("trx") ?? []),
    ...(recentSessionTargetsByClass.get("stretch") ?? []),
    ...(recentSessionTargetsByClass.get("mobility") ?? []),
  ];

  const lookupKeys = [
    "collective-drop-in-eur-once-v1",
    "qa-collective-5-pack-eur-once-v1",
    "collective-10-pack-eur-once-v1",
    "monthly-unlimited-collective-eur-monthly-v1",
  ] as const;
  const catalogPrices = await prisma.price.findMany({
    where: {
      lookupKey: { in: [...lookupKeys] },
      isActive: true,
      isArchived: false,
    },
    include: { product: true },
  });
  const priceByLookupKey = new Map(catalogPrices.map((price) => [price.lookupKey, price]));
  const rules = await prisma.entitlementRule.findMany({
    where: {
      productId: { in: catalogPrices.map((price) => price.productId) },
      isActive: true,
    },
  });
  const ruleByProductId = new Map(rules.map((rule) => [rule.productId, rule]));

  const entitlementsByClient = new Map<string, EntitlementSeedState[]>();
  let seededCommercialPurchasesCount = 0;

  function registerEntitlement(entitlement: EntitlementSeedState) {
    const current = entitlementsByClient.get(entitlement.clientId) ?? [];
    current.push(entitlement);
    current.sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime());
    entitlementsByClient.set(entitlement.clientId, current);
  }

  async function createCommercialPurchase(input: {
    clientId: string;
    lookupKey: (typeof lookupKeys)[number];
    purchasedAt: Date;
  }) {
    const price = priceByLookupKey.get(input.lookupKey);
    if (!price) {
      throw new Error(`Seed purchase configuration missing price ${input.lookupKey}`);
    }
    const rule = ruleByProductId.get(price.productId);
    if (!rule) {
      throw new Error(`Seed purchase configuration missing entitlement rule for product ${price.productId}`);
    }

    const totalAmountMinor = price.unitAmountMinor;
    const order = await prisma.order.create({
      data: {
        clientId: input.clientId,
        subtotalAmountMinor: totalAmountMinor,
        discountAmountMinor: 0,
        totalAmountMinor,
        currencyCode: price.currencyCode,
        status: OrderStatus.PAID,
        placedAt: input.purchasedAt,
      },
    });

    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        productId: price.productId,
        priceId: price.id,
        quantity: 1,
        productNameSnapshot: price.product.name,
        priceNameSnapshot: price.name,
        unitAmountMinor: price.unitAmountMinor,
        lineSubtotalAmountMinor: totalAmountMinor,
        lineDiscountAmountMinor: 0,
        lineTotalAmountMinor: totalAmountMinor,
        currencyCode: price.currencyCode,
      },
    });

    await prisma.payment.create({
      data: {
        orderId: order.id,
        status: PaymentStatus.SUCCEEDED,
        method: PaymentMethod.CARD,
        provider: PaymentProvider.STRIPE,
        providerReference: `seed-payment-${order.id}`,
        stripeCheckoutSessionId: `cs_test_seed_${order.id.slice(0, 16)}`,
        stripeCustomerId: `cus_seed_${input.clientId.slice(0, 12)}`,
        stripeCheckoutMode:
          price.priceType === PriceType.RECURRING
            ? StripeCheckoutMode.SUBSCRIPTION
            : StripeCheckoutMode.PAYMENT,
        amountMinor: totalAmountMinor,
        currencyCode: price.currencyCode,
        authorizedAt: input.purchasedAt,
        capturedAt: input.purchasedAt,
        createdAt: input.purchasedAt,
      },
    });

    let subscriptionContractId: string | null = null;
    let entitlementExpiresAt: Date | null = null;
    if (price.priceType === PriceType.RECURRING) {
      const intervalCount = price.billingIntervalCount ?? 1;
      const periodEnd =
        price.billingInterval === BillingInterval.MONTH
          ? addMonths(input.purchasedAt, intervalCount)
          : addDays(input.purchasedAt, 30 * intervalCount);
      const subscriptionStatus = periodEnd > now ? SubscriptionStatus.ACTIVE : SubscriptionStatus.EXPIRED;
      const contract = await prisma.subscriptionContract.create({
        data: {
          clientId: input.clientId,
          productId: price.productId,
          priceId: price.id,
          status: subscriptionStatus,
          startsAt: input.purchasedAt,
          currentPeriodStart: input.purchasedAt,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: subscriptionStatus === SubscriptionStatus.EXPIRED,
          endedAt: subscriptionStatus === SubscriptionStatus.EXPIRED ? periodEnd : null,
          provider: PaymentProvider.STRIPE,
          providerSubscriptionReference: `sub_seed_${order.id.slice(0, 20)}`,
        },
      });
      subscriptionContractId = contract.id;
      entitlementExpiresAt = periodEnd;
    } else if (rule.validForDays && rule.validForDays > 0) {
      entitlementExpiresAt = addDays(input.purchasedAt, rule.validForDays);
    }

    const entitlementStatus =
      entitlementExpiresAt && entitlementExpiresAt <= now
        ? ClientEntitlementStatus.EXPIRED
        : ClientEntitlementStatus.ACTIVE;
    const entitlement = await prisma.clientEntitlement.create({
      data: {
        clientId: input.clientId,
        productId: price.productId,
        orderId: order.id,
        subscriptionContractId,
        entitlementType: rule.entitlementType,
        entitlementScope: rule.entitlementScope,
        status: entitlementStatus,
        activatedAt: input.purchasedAt,
        expiresAt: entitlementExpiresAt,
      },
    });

    let grantedCredits = 0;
    if (rule.entitlementType === EntitlementType.CREDIT_PACK) {
      grantedCredits = rule.quantity ?? 0;
    }
    if (rule.entitlementType === EntitlementType.SINGLE_USE) {
      grantedCredits = 1;
    }

    if (grantedCredits > 0) {
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.clientId,
          entryType: CreditLedgerEntryType.GRANT,
          amount: grantedCredits,
          happenedAt: input.purchasedAt,
          entitlementId: entitlement.id,
          orderId: order.id,
          notes: `Seed purchase grant (${input.lookupKey})`,
        },
      });
    }

    registerEntitlement({
      id: entitlement.id,
      clientId: input.clientId,
      orderId: order.id,
      priceId: price.id,
      activatedAt: input.purchasedAt,
      expiresAt: entitlementExpiresAt,
      entitlementType: rule.entitlementType,
      entitlementScope: rule.entitlementScope,
      creditsRemaining: grantedCredits,
      unlimitedAccess: rule.entitlementType === EntitlementType.UNLIMITED_ACCESS,
    });
    seededCommercialPurchasesCount += 1;
  }

  const powerPurchasePlan: Record<string, Array<{ lookupKey: (typeof lookupKeys)[number]; daysAgo: number }>> = {
    Katalin: [
      { lookupKey: "collective-10-pack-eur-once-v1", daysAgo: 55 },
      { lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 27 },
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 8 },
    ],
    "Maja Simunic": [
      { lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 58 },
      { lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 26 },
      { lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 5 },
    ],
    Eline: [
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 50 },
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 15 },
    ],
    "Batool Dodin": [
      { lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 48 },
      { lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 12 },
    ],
    "Kriselda Deda": [
      { lookupKey: "collective-10-pack-eur-once-v1", daysAgo: 45 },
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 6 },
    ],
  };
  const regularPurchasePlan: Record<string, Array<{ lookupKey: (typeof lookupKeys)[number]; daysAgo: number }>> = {
    Alice: [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 24 }],
    Beatrice: [{ lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 9 }],
    Celine: [
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 32 },
      { lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 10 },
    ],
    Diana: [{ lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 20 }],
    Eva: [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 18 }],
    Fatima: [{ lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 7 }],
    Grace: [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 36 }],
    Hana: [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 14 }],
    Ines: [{ lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 13 }],
    Jade: [{ lookupKey: "monthly-unlimited-collective-eur-monthly-v1", daysAgo: 11 }],
    "Recovered Client": [
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 56 },
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 16 },
    ],
    "Cancelled Pattern Client": [
      { lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 35 },
      { lookupKey: "collective-drop-in-eur-once-v1", daysAgo: 9 },
    ],
  };
  const atRiskPurchasePlan: Record<string, Array<{ lookupKey: (typeof lookupKeys)[number]; daysAgo: number }>> = {
    "Engy Sawah": [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 58 }],
    "Nela O": [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 57 }],
    Francesca: [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 59 }],
    "Nolwenn Bertrand": [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 54 }],
    "Svitlana Metelytsia": [{ lookupKey: "qa-collective-5-pack-eur-once-v1", daysAgo: 52 }],
  };

  for (const [name, plan] of Object.entries(powerPurchasePlan)) {
    for (const purchase of plan) {
      await createCommercialPurchase({
        clientId: clientRecords.get(name)!.id,
        lookupKey: purchase.lookupKey,
        purchasedAt: daysAgo(purchase.daysAgo),
      });
    }
  }
  for (const [name, plan] of Object.entries(regularPurchasePlan)) {
    for (const purchase of plan) {
      await createCommercialPurchase({
        clientId: clientRecords.get(name)!.id,
        lookupKey: purchase.lookupKey,
        purchasedAt: daysAgo(purchase.daysAgo),
      });
    }
  }
  for (const [name, plan] of Object.entries(atRiskPurchasePlan)) {
    for (const purchase of plan) {
      await createCommercialPurchase({
        clientId: clientRecords.get(name)!.id,
        lookupKey: purchase.lookupKey,
        purchasedAt: daysAgo(purchase.daysAgo),
      });
    }
  }
  await createCommercialPurchase({
    clientId: seedClient.id,
    lookupKey: "qa-collective-5-pack-eur-once-v1",
    purchasedAt: daysAgo(19),
  });
  console.info(`[seed] Dashboard commercial purchases created: ${seededCommercialPurchasesCount}`);

  const bookedPairSet = new Set<string>();
  const validBookedCountBySessionId = new Map<string, number>();
  for (const session of recentSessionTargets) {
    validBookedCountBySessionId.set(session.sessionId, 0);
  }

  async function createBooking(input: {
    clientId: string;
    sessionId: string;
    startsAt: Date;
    status: BookingStatus;
    cancelledAt?: Date;
  }): Promise<boolean> {
    const pairKey = `${input.clientId}::${input.sessionId}`;
    if (bookedPairSet.has(pairKey)) {
      return false;
    }

    const availableEntitlements = entitlementsByClient.get(input.clientId) ?? [];
    const entitlement = availableEntitlements.find((candidate) => {
      if (candidate.entitlementScope !== EntitlementScope.COLLECTIVE_CLASSES) {
        return false;
      }
      if (input.startsAt < candidate.activatedAt) {
        return false;
      }
      if (candidate.expiresAt && input.startsAt > candidate.expiresAt) {
        return false;
      }
      if (candidate.unlimitedAccess) {
        return true;
      }
      return candidate.creditsRemaining > 0;
    });
    if (!entitlement) {
      return false;
    }

    const sessionTarget = recentSessionTargets.find((entry) => entry.sessionId === input.sessionId);
    if (sessionTarget && COUNTED_BOOKING_STATUSES.includes(input.status)) {
      const current = validBookedCountBySessionId.get(input.sessionId) ?? 0;
      if (current >= sessionTarget.capacity) {
        return false;
      }
    }

    bookedPairSet.add(pairKey);
    if (sessionTarget && COUNTED_BOOKING_STATUSES.includes(input.status)) {
      validBookedCountBySessionId.set(input.sessionId, (validBookedCountBySessionId.get(input.sessionId) ?? 0) + 1);
    }

    const bookedAt = new Date(input.startsAt);
    bookedAt.setUTCDate(bookedAt.getUTCDate() - 1);
    const cancellationEligibleUntilAt = new Date(input.startsAt);
    cancellationEligibleUntilAt.setUTCHours(cancellationEligibleUntilAt.getUTCHours() - 24);

    const booking = await prisma.booking.create({
      data: {
        clientId: input.clientId,
        studioSessionId: input.sessionId,
        orderId: entitlement.orderId,
        status: input.status,
        bookingIntent: BookingIntent.USE_PLAN,
        paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
        selectedEntitlementId: entitlement.id,
        selectedPriceId: entitlement.priceId,
        bookedAt,
        cancellationEligibleUntilAt,
        cancelledAt: input.cancelledAt,
        creditRefundedAt: input.status === BookingStatus.CANCELLED ? input.cancelledAt ?? bookedAt : null,
      },
    });

    if (!entitlement.unlimitedAccess) {
      entitlement.creditsRemaining -= 1;
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: input.clientId,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          happenedAt: bookedAt,
          entitlementId: entitlement.id,
          bookingId: booking.id,
          orderId: entitlement.orderId,
          notes: "Seed booking credit consume",
        },
      });

      if (input.status === BookingStatus.CANCELLED) {
        entitlement.creditsRemaining += 1;
        await prisma.creditLedgerEntry.create({
          data: {
            clientId: input.clientId,
            entryType: CreditLedgerEntryType.RESTORE,
            amount: 1,
            happenedAt: input.cancelledAt ?? bookedAt,
            entitlementId: entitlement.id,
            bookingId: booking.id,
            orderId: entitlement.orderId,
            notes: "Seed booking cancellation credit restore",
          },
        });
      }
    }

    return true;
  }

  const topClientTargets = [
    { name: "Katalin", count: 11 },
    { name: "Maja Simunic", count: 9 },
    { name: "Eline", count: 7 },
    { name: "Batool Dodin", count: 7 },
    { name: "Kriselda Deda", count: 7 },
  ] as const;

  const recentSessionCursorByClient = new Map<string, number>();
  for (const topClient of topClientTargets) {
    let created = 0;
    let attempts = 0;
    while (created < topClient.count && attempts < recentSessionTargets.length * 10) {
      const currentCursor = recentSessionCursorByClient.get(topClient.name) ?? 0;
      const session = recentSessionTargets[currentCursor % recentSessionTargets.length];
      recentSessionCursorByClient.set(topClient.name, currentCursor + 1);
      attempts += 1;
      if (!session) {
        break;
      }
      const createdSuccessfully = await createBooking({
        clientId: clientRecords.get(topClient.name)!.id,
        sessionId: session.sessionId,
        startsAt: session.startsAt,
        status: BookingStatus.CONFIRMED,
      });
      if (createdSuccessfully) {
        created += 1;
      }
    }
  }

  const fillerClients = [
    seedClient.id,
    ...otherClientNames.map((name) => clientRecords.get(name)!.id),
    clientRecords.get("Recovered Client")!.id,
  ];
  let fillerCursor = 0;
  for (const session of recentSessionTargets) {
    const desired = session.target;
    let attempts = 0;
    while (
      (validBookedCountBySessionId.get(session.sessionId) ?? 0) < desired &&
      attempts < fillerClients.length * 8
    ) {
      const clientId = fillerClients[fillerCursor % fillerClients.length];
      fillerCursor += 1;
      attempts += 1;
      const createdSuccessfully = await createBooking({
        clientId,
        sessionId: session.sessionId,
        startsAt: session.startsAt,
        status: BookingStatus.CONFIRMED,
      });
      if (createdSuccessfully) {
        attempts = 0;
      }
    }
  }

  const historicalSessions = [
    ...(historicalSessionsByClass.get("pilatesProps") ?? []),
    ...(historicalSessionsByClass.get("rocket") ?? []),
    ...(historicalSessionsByClass.get("vinyasa") ?? []),
    ...(historicalSessionsByClass.get("trx") ?? []),
    ...(historicalSessionsByClass.get("stretch") ?? []),
  ];
  let historicalCursor = 0;
  for (const clientName of atRiskNames) {
    for (let i = 0; i < 2; i += 1) {
      const session = historicalSessions[historicalCursor % historicalSessions.length]!;
      historicalCursor += 1;
      await prisma.booking.create({
        data: {
          clientId: clientRecords.get(clientName)!.id,
          studioSessionId: session.sessionId,
          status: BookingStatus.COMPLETED,
          bookedAt: new Date(session.startsAt.getTime() - 24 * 60 * 60 * 1000),
        },
      });
    }
  }

  const recoveredHistoricalSession = historicalSessions[historicalCursor % historicalSessions.length]!;
  await prisma.booking.create({
    data: {
      clientId: clientRecords.get("Recovered Client")!.id,
      studioSessionId: recoveredHistoricalSession.sessionId,
      status: BookingStatus.COMPLETED,
      bookedAt: new Date(recoveredHistoricalSession.startsAt.getTime() - 24 * 60 * 60 * 1000),
    },
  });

  const recoveredRecentSession = recentSessionTargets[0]!;
  await createBooking({
    clientId: clientRecords.get("Recovered Client")!.id,
    sessionId: recoveredRecentSession.sessionId,
    startsAt: recoveredRecentSession.startsAt,
    status: BookingStatus.CONFIRMED,
  });

  const cancellationClients = [
    clientRecords.get("Cancelled Pattern Client")!.id,
    clientRecords.get("Engy Sawah")!.id,
    clientRecords.get("Nela O")!.id,
  ];
  for (let index = 0; index < 12; index += 1) {
    const session = recentSessionTargets[index % recentSessionTargets.length]!;
    const bookedAt = new Date(session.startsAt.getTime() - 24 * 60 * 60 * 1000);
    await createBooking({
      clientId: cancellationClients[index % cancellationClients.length]!,
      sessionId: session.sessionId,
      startsAt: session.startsAt,
      status: BookingStatus.CANCELLED,
      cancelledAt: new Date(bookedAt.getTime() + 60 * 60 * 1000),
    });
  }

  const trendCategory = await upsertClassCategory({
    slug: "seed-demo-trend-analytics-category",
    name: "Seed Demo Trend Analytics",
    description: "Deterministic dashboard trend demo classes.",
    sortOrder: 99,
  });
  const trendClassType = await upsertClassType({
    slug: "seed-demo-trend-analytics-class",
    categoryId: trendCategory.id,
    name: "Seed Demo Trend Session Class",
    description: "Dashboard trend analytics seed class.",
    defaultDurationMinutes: 60,
    defaultCapacity: 42,
    pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
    sortOrder: 999,
  });
  const trendTemplate = await upsertClassTemplate({
    slug: "seed-demo-trend-analytics-template",
    classTypeId: trendClassType.id,
    defaultTeacherId: staffByName.get("Orsi")!.id,
    title: "Seed Demo Trend Session",
    description: "Deterministic trend template",
    location: "Ixelles Insights Studio",
    defaultCapacity: 42,
    defaultDurationMinutes: 60,
  });

  const trendPrice = priceByLookupKey.get("collective-drop-in-eur-once-v1");
  if (!trendPrice) {
    throw new Error("Dashboard trend seed requires collective-drop-in-eur-once-v1 price.");
  }

  await prisma.session.deleteMany({
    where: {
      sessionToken: {
        startsWith: `${DASHBOARD_TREND_MARKER}-session-`,
      },
    },
  });
  await prisma.booking.deleteMany({
    where: {
      customerEmail: DASHBOARD_TREND_CUSTOMER_EMAIL,
    },
  });
  await prisma.payment.deleteMany({
    where: {
      providerReference: {
        startsWith: `${DASHBOARD_TREND_MARKER}-payment-`,
      },
    },
  });
  await prisma.order.deleteMany({
    where: {
      notes: {
        startsWith: `${DASHBOARD_TREND_MARKER}-order-`,
      },
    },
  });
  await prisma.studioSession.deleteMany({
    where: {
      classTemplateId: trendTemplate.id,
      title: {
        startsWith: "Seed Demo Trend Session ",
      },
    },
  });

  const trendClientPool: string[] = [];
  for (let index = 0; index < 48; index += 1) {
    const label = String(index + 1).padStart(2, "0");
    const trendUser = await prisma.user.upsert({
      where: {
        email: `seed-demo-trend-client-${label}@yogapilatesfitness.local`,
      },
      update: {
        name: `Seed Demo Trend Client ${label}`,
        firstName: "Seed",
        lastName: `Trend${label}`,
        role: Role.CLIENT,
        isActive: true,
        isInactive: false,
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      },
      create: {
        name: `Seed Demo Trend Client ${label}`,
        firstName: "Seed",
        lastName: `Trend${label}`,
        email: `seed-demo-trend-client-${label}@yogapilatesfitness.local`,
        role: Role.CLIENT,
        isActive: true,
        isInactive: false,
        emailVerified: new Date("2026-01-01T00:00:00.000Z"),
      },
      select: { id: true },
    });
    trendClientPool.push(trendUser.id);
  }
  const trendAsOfOverride = parseDashboardTrendAsOfDate(process.env.DASHBOARD_TREND_AS_OF_DATE);
  const trendToday = trendAsOfOverride ?? startOfUtcDay(new Date());
  const trendStart = addDays(trendToday, -99);

  for (let dayIndex = 0; dayIndex < 100; dayIndex += 1) {
    const day = addDays(trendStart, dayIndex);
    const dayKey = dateKey(day);
    const weekday = day.getUTCDay();
    const weekendMultiplier = weekday === 0 || weekday === 6 ? 0.76 : 1;
    const weeklyWave = Math.sin((dayIndex / 7) * Math.PI * 2);
    const monthlyWave = Math.sin((dayIndex / 30) * Math.PI * 2);
    const spike = dayIndex % 19 === 0 || dayIndex % 31 === 0 ? 1.22 : 1;

    const sessionsCount = Math.max(
      5,
      Math.round((8 + weeklyWave * 2.6 + monthlyWave * 2.1) * weekendMultiplier * spike),
    );
    const rawBookingsCount = Math.max(
      sessionsCount + 3,
      Math.round(sessionsCount * (2.1 + ((weeklyWave + 1) / 2) * 0.45)),
    );
    const bookingsCount = Math.min(rawBookingsCount, trendClientPool.length);
    const cancellationsCount = Math.min(
      Math.max(1, Math.round(bookingsCount * (0.11 + (dayIndex % 14 === 0 ? 0.03 : 0)))),
      bookingsCount - 1,
    );
    const ordersCount = Math.max(1, Math.round(bookingsCount * (0.39 + ((monthlyWave + 1) / 2) * 0.06)));

    for (let sessionIndex = 0; sessionIndex < sessionsCount; sessionIndex += 1) {
      const createdAt = new Date(day);
      createdAt.setUTCHours(6 + (sessionIndex % 12), (sessionIndex * 7) % 60, 0, 0);
      await prisma.session.create({
        data: {
          sessionToken: `${DASHBOARD_TREND_MARKER}-session-${dayKey}-${sessionIndex}`,
          userId: seedClient.id,
          expires: addDays(createdAt, 30),
          createdAt,
        },
      });
    }

    const startsAt = new Date(day);
    startsAt.setUTCHours(18, 0, 0, 0);
    const trendStudioSession = await upsertStudioSession({
      classTemplateId: trendTemplate.id,
      classTypeId: trendClassType.id,
      teacherId: staffByName.get("Orsi")!.id,
      title: `Seed Demo Trend Session ${dayKey}`,
      description: "Deterministic dashboard analytics trend session.",
      location: trendTemplate.location ?? undefined,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
      capacity: Math.max(bookingsCount + 6, 22),
    });
    await prisma.studioSession.update({
      where: { id: trendStudioSession.id },
      data: { status: StudioSessionStatus.COMPLETED },
    });

    for (let bookingIndex = 0; bookingIndex < bookingsCount; bookingIndex += 1) {
      const bookingClientId = trendClientPool[(dayIndex * 41 + bookingIndex) % trendClientPool.length]!;
      const isCancelled = bookingIndex < cancellationsCount;
      const bookedAt = new Date(day);
      bookedAt.setUTCHours(9, (bookingIndex * 5) % 60, 0, 0);
      const cancelledAt = isCancelled
        ? (() => {
            const value = new Date(day);
            value.setUTCHours(15, (bookingIndex * 3) % 60, 0, 0);
            return value;
          })()
        : undefined;

      await prisma.booking.create({
        data: {
          clientId: bookingClientId,
          studioSessionId: trendStudioSession.id,
          status: isCancelled ? BookingStatus.CANCELLED : BookingStatus.CONFIRMED,
          bookingIntent: BookingIntent.SINGLE_BOOKING,
          paymentSelection: BookingPaymentSelection.SINGLE_SESSION,
          customerName: "Seed Demo Trend",
          customerEmail: DASHBOARD_TREND_CUSTOMER_EMAIL,
          bookedAt,
          cancelledAt,
          cancellationReason: isCancelled ? `${DASHBOARD_TREND_MARKER}-cancel-${dayKey}` : null,
        },
      });
    }

    for (let orderIndex = 0; orderIndex < ordersCount; orderIndex += 1) {
      const orderClientId = trendClientPool[(dayIndex * 13 + orderIndex) % trendClientPool.length]!;
      const placedAt = new Date(day);
      placedAt.setUTCHours(11, (orderIndex * 4) % 60, 0, 0);
      const totalAmountMinor = Math.max(
        1200,
        Math.round(
          trendPrice.unitAmountMinor * (0.92 + ((monthlyWave + 1) / 2) * 0.18) +
            bookingsCount * 30 +
            sessionsCount * 22,
        ),
      );

      const order = await prisma.order.create({
        data: {
          clientId: orderClientId,
          subtotalAmountMinor: totalAmountMinor,
          discountAmountMinor: 0,
          totalAmountMinor: totalAmountMinor,
          currencyCode: trendPrice.currencyCode,
          status: OrderStatus.PAID,
          placedAt,
          notes: `${DASHBOARD_TREND_MARKER}-order-${dayKey}-${orderIndex}`,
        },
      });

      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          productId: trendPrice.productId,
          priceId: trendPrice.id,
          quantity: 1,
          productNameSnapshot: trendPrice.product.name,
          priceNameSnapshot: trendPrice.name,
          unitAmountMinor: totalAmountMinor,
          lineSubtotalAmountMinor: totalAmountMinor,
          lineDiscountAmountMinor: 0,
          lineTotalAmountMinor: totalAmountMinor,
          currencyCode: trendPrice.currencyCode,
        },
      });

      await prisma.payment.create({
        data: {
          orderId: order.id,
          status: PaymentStatus.SUCCEEDED,
          method: PaymentMethod.CARD,
          provider: PaymentProvider.STRIPE,
          providerReference: `${DASHBOARD_TREND_MARKER}-payment-${dayKey}-${orderIndex}`,
          amountMinor: totalAmountMinor,
          currencyCode: trendPrice.currencyCode,
          authorizedAt: placedAt,
          capturedAt: placedAt,
          createdAt: placedAt,
        },
      });
    }
  }
}

async function verifyCleanSeed(
  clientEmail: string,
  schedulingSummary: Awaited<ReturnType<typeof seedScheduling>>,
) {
  const [totalClients, verifiedActiveClientsWithProfile, totalAdminsAndMasterAdmins, totalTeachers] =
    await prisma.$transaction([
      prisma.user.count({ where: { role: Role.CLIENT } }),
      prisma.user.count({
        where: {
          role: Role.CLIENT,
          emailVerified: { not: null },
          isActive: true,
          isInactive: false,
          clientProfile: { isNot: null },
        },
      }),
      prisma.user.count({ where: { role: { in: [Role.ADMIN, Role.MASTER_ADMIN] } } }),
      prisma.user.count({ where: { role: Role.TEACHER } }),
    ]);

  if (totalClients !== SEED_CLIENT_COUNT) {
    throw new Error(`Seed verification failed: expected ${SEED_CLIENT_COUNT} clients, got ${totalClients}.`);
  }
  if (verifiedActiveClientsWithProfile !== SEED_CLIENT_COUNT) {
    throw new Error(
      `Seed verification failed: expected ${SEED_CLIENT_COUNT} verified active clients with profiles, got ${verifiedActiveClientsWithProfile}.`,
    );
  }
  if (totalAdminsAndMasterAdmins !== 2) {
    throw new Error(`Seed verification failed: expected 2 admin/master-admin users, got ${totalAdminsAndMasterAdmins}.`);
  }
  if (totalTeachers !== 3) {
    throw new Error(`Seed verification failed: expected 3 teachers, got ${totalTeachers}.`);
  }

  const [productCount, collectivePastSessionsCount, collectiveFutureSessionsCount, collectiveCapacityMismatchCount] =
    await prisma.$transaction([
      prisma.product.count({ where: { isActive: true, isArchived: false } }),
      prisma.studioSession.count({
        where: {
          startsAt: { gte: pastWindowStartUtc, lte: pastWindowEndUtc },
          classType: { category: { slug: { not: "private-reformer-coach" } } },
        },
      }),
      prisma.studioSession.count({
        where: {
          startsAt: { gte: futureWindowStartUtc, lte: futureWindowEndUtc },
          classType: { category: { slug: { not: "private-reformer-coach" } } },
        },
      }),
      prisma.studioSession.count({
        where: {
          startsAt: { gte: pastWindowStartUtc, lte: futureWindowEndUtc },
          classType: { category: { slug: { not: "private-reformer-coach" } } },
          capacity: { not: COLLECTIVE_SESSION_CAPACITY },
        },
      }),
    ]);

  if (productCount !== 6) {
    throw new Error(`Seed verification failed: expected 6 active products, got ${productCount}.`);
  }
  if (collectivePastSessionsCount !== schedulingSummary.pastSessionsCount) {
    throw new Error(
      `Seed verification failed: past collective session count mismatch (expected ${schedulingSummary.pastSessionsCount}, got ${collectivePastSessionsCount}).`,
    );
  }
  if (collectiveFutureSessionsCount !== schedulingSummary.futureSessionsCount) {
    throw new Error(
      `Seed verification failed: future collective session count mismatch (expected ${schedulingSummary.futureSessionsCount}, got ${collectiveFutureSessionsCount}).`,
    );
  }
  if (collectiveCapacityMismatchCount !== 0) {
    throw new Error(`Seed verification failed: found ${collectiveCapacityMismatchCount} collective sessions with non-15 capacity.`);
  }

  const prices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: [
          "collective-drop-in-eur-once-v1",
          "qa-collective-5-pack-eur-once-v1",
          "collective-10-pack-eur-once-v1",
          "monthly-unlimited-collective-eur-monthly-v1",
          "qa-private-5-pack-eur-once-v1",
        ],
      },
    },
    select: { lookupKey: true, productId: true },
  });
  const productIdByLookupKey = new Map(prices.map((price) => [price.lookupKey, price.productId]));
  const collectiveDropInProductId = productIdByLookupKey.get("collective-drop-in-eur-once-v1");
  const collective5PackProductId = productIdByLookupKey.get("qa-collective-5-pack-eur-once-v1");
  const collective10PackProductId = productIdByLookupKey.get("collective-10-pack-eur-once-v1");
  const collectiveMonthlyProductId = productIdByLookupKey.get("monthly-unlimited-collective-eur-monthly-v1");
  if (
    !collectiveDropInProductId ||
    !collective5PackProductId ||
    !collective10PackProductId ||
    !collectiveMonthlyProductId
  ) {
    throw new Error("Seed verification failed: missing required catalog product IDs for collective ownership checks.");
  }

  const [
    activeCollectiveDropInClients,
    activeCollective5PackClients,
    activeCollective10PackClients,
    activeMonthlyClients,
    expiredCollectiveHistoryClients,
    activeCollectiveOwnershipClients,
  ] = await prisma.$transaction([
    prisma.clientEntitlement.findMany({
      where: {
        productId: collectiveDropInProductId,
        status: ClientEntitlementStatus.ACTIVE,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        productId: collective5PackProductId,
        status: ClientEntitlementStatus.ACTIVE,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        productId: collective10PackProductId,
        status: ClientEntitlementStatus.ACTIVE,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        productId: collectiveMonthlyProductId,
        status: ClientEntitlementStatus.ACTIVE,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.EXPIRED,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
      },
      distinct: ["clientId"],
      select: { clientId: true },
    }),
  ]);

  const allPrivateEntitlementClients = await prisma.clientEntitlement.findMany({
    where: { entitlementScope: EntitlementScope.PRIVATE_CLASSES },
    distinct: ["clientId"],
    select: { clientId: true },
  });
  const allCollectiveEntitlementClients = await prisma.clientEntitlement.findMany({
    where: { entitlementScope: EntitlementScope.COLLECTIVE_CLASSES },
    distinct: ["clientId"],
    select: { clientId: true },
  });
  const collectiveClientIdSet = new Set(allCollectiveEntitlementClients.map((entry) => entry.clientId));
  const privateOnlyClientsCount = allPrivateEntitlementClients.filter(
    (entry) => !collectiveClientIdSet.has(entry.clientId),
  ).length;
  const noActiveOwnershipCount = SEED_CLIENT_COUNT - activeCollectiveOwnershipClients.length;

  if (activeCollectiveDropInClients.length === 0) {
    throw new Error("Seed verification failed: expected active collective drop-in ownership.");
  }
  if (activeCollective5PackClients.length === 0) {
    throw new Error("Seed verification failed: expected active collective 5-pack ownership.");
  }
  if (activeCollective10PackClients.length === 0) {
    throw new Error("Seed verification failed: expected active collective 10-pack ownership.");
  }
  if (activeMonthlyClients.length === 0) {
    throw new Error("Seed verification failed: expected active monthly collective ownership.");
  }
  if (expiredCollectiveHistoryClients.length === 0) {
    throw new Error("Seed verification failed: expected expired collective history clients.");
  }
  if (noActiveOwnershipCount <= 0) {
    throw new Error("Seed verification failed: expected some clients with no active collective ownership.");
  }
  if (privateOnlyClientsCount <= 0) {
    throw new Error("Seed verification failed: expected private-only ownership clients.");
  }

  const [ordersCount, paymentsCount, entitlementsCount, subscriptionContractsCount, creditLedgerEntriesCount] =
    await prisma.$transaction([
      prisma.order.count(),
      prisma.payment.count({ where: { status: PaymentStatus.SUCCEEDED } }),
      prisma.clientEntitlement.count(),
      prisma.subscriptionContract.count(),
      prisma.creditLedgerEntry.count(),
    ]);
  if (ordersCount !== schedulingSummary.ordersCreatedCount) {
    throw new Error(
      `Seed verification failed: order count mismatch (expected ${schedulingSummary.ordersCreatedCount}, got ${ordersCount}).`,
    );
  }
  if (paymentsCount !== schedulingSummary.paymentsCreatedCount) {
    throw new Error(
      `Seed verification failed: payment count mismatch (expected ${schedulingSummary.paymentsCreatedCount}, got ${paymentsCount}).`,
    );
  }
  if (entitlementsCount !== schedulingSummary.entitlementsCreatedCount) {
    throw new Error(
      `Seed verification failed: entitlement count mismatch (expected ${schedulingSummary.entitlementsCreatedCount}, got ${entitlementsCount}).`,
    );
  }
  if (subscriptionContractsCount !== schedulingSummary.subscriptionContractsCreatedCount) {
    throw new Error(
      `Seed verification failed: subscription contract count mismatch (expected ${schedulingSummary.subscriptionContractsCreatedCount}, got ${subscriptionContractsCount}).`,
    );
  }
  if (creditLedgerEntriesCount !== schedulingSummary.creditLedgerEntriesCreatedCount) {
    throw new Error(
      `Seed verification failed: credit ledger count mismatch (expected ${schedulingSummary.creditLedgerEntriesCreatedCount}, got ${creditLedgerEntriesCount}).`,
    );
  }

  const [pastBookingsCount, futureBookingsCount] = await prisma.$transaction([
    prisma.booking.count({
      where: { studioSession: { startsAt: { gte: pastWindowStartUtc, lte: pastWindowEndUtc } } },
    }),
    prisma.booking.count({
      where: { studioSession: { startsAt: { gte: futureWindowStartUtc, lte: futureWindowEndUtc } } },
    }),
  ]);
  if (pastBookingsCount !== schedulingSummary.pastBookingsCount) {
    throw new Error(
      `Seed verification failed: past booking count mismatch (expected ${schedulingSummary.pastBookingsCount}, got ${pastBookingsCount}).`,
    );
  }
  if (futureBookingsCount !== schedulingSummary.futureBookingsCount) {
    throw new Error(
      `Seed verification failed: future booking count mismatch (expected ${schedulingSummary.futureBookingsCount}, got ${futureBookingsCount}).`,
    );
  }

  const duplicateActiveBookings = await prisma.$queryRaw<Array<{ duplicate_count: bigint }>>`
    SELECT COUNT(*)::bigint AS duplicate_count
    FROM (
      SELECT "clientId", "studioSessionId", COUNT(*) AS row_count
      FROM "Booking"
      WHERE "clientId" IS NOT NULL
        AND status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
      GROUP BY "clientId", "studioSessionId"
      HAVING COUNT(*) > 1
    ) duplicates
  `;
  const duplicateCount = Number(duplicateActiveBookings[0]?.duplicate_count ?? 0n);
  if (duplicateCount > 0) {
    throw new Error(`Seed verification failed: found ${duplicateCount} duplicate active bookings.`);
  }

  const futureSessionIds = (
    await prisma.studioSession.findMany({
      where: {
        startsAt: { gte: futureWindowStartUtc, lte: futureWindowEndUtc },
        classType: { category: { slug: { not: "private-reformer-coach" } } },
      },
      select: { id: true, capacity: true },
    })
  ).map((session) => ({ id: session.id, capacity: session.capacity }));
  const bookingsByFutureSession = await prisma.booking.groupBy({
    by: ["studioSessionId"],
    where: {
      studioSessionId: { in: futureSessionIds.map((session) => session.id) },
      status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW] },
    },
    _count: { _all: true },
  });
  const bookingCountBySessionId = new Map(bookingsByFutureSession.map((entry) => [entry.studioSessionId, entry._count._all]));
  const fullFutureSessions = futureSessionIds.filter(
    (session) => (bookingCountBySessionId.get(session.id) ?? 0) >= session.capacity,
  ).length;
  const nearFullFutureSessions = futureSessionIds.filter(
    (session) => (bookingCountBySessionId.get(session.id) ?? 0) >= 13,
  ).length;
  if (fullFutureSessions >= futureSessionIds.length) {
    throw new Error("Seed verification failed: all future collective sessions are full.");
  }
  if (nearFullFutureSessions < 5) {
    throw new Error(`Seed verification failed: expected at least 5 near-full future sessions, got ${nearFullFutureSessions}.`);
  }

  const waitlistEntriesCount = await prisma.waitlistEntry.count();
  if (waitlistEntriesCount !== 0) {
    throw new Error(`Seed verification failed: expected 0 waitlist entries in baseline seed, got ${waitlistEntriesCount}.`);
  }

  const client = await prisma.user.findUnique({
    where: { email: clientEmail },
    select: { id: true },
  });
  if (!client) {
    throw new Error("Seed verification failed: QA client missing.");
  }
}

async function main() {
  const stripePriceIdByLookupKey = resolveRequiredCatalogStripePriceIds();
  await purgeForCleanSeed();
  const users = await seedUsers();
  await seedBookingPolicy();
  await seedCatalog(stripePriceIdByLookupKey);
  await seedMarketingDemoData({ createdById: users.admin.id });
  const schedulingSummary = await seedScheduling({
    anaId: users.teachers.ana.id,
    elenaId: users.teachers.elena.id,
    sofiaId: users.teachers.sofia.id,
  });
  await seedLearningFromJson();
  await verifyCleanSeed(users.client.email, schedulingSummary);

  console.info(
    `[seed] completed: clients=${schedulingSummary.clientsSeeded}, pastSessions=${schedulingSummary.pastSessionsCount}, futureSessions=${schedulingSummary.futureSessionsCount}, pastBookings=${schedulingSummary.pastBookingsCount}, futureBookings=${schedulingSummary.futureBookingsCount}, orders=${schedulingSummary.ordersCreatedCount}, payments=${schedulingSummary.paymentsCreatedCount}, entitlements=${schedulingSummary.entitlementsCreatedCount}, subscriptionContracts=${schedulingSummary.subscriptionContractsCreatedCount}, nearFullFutureSessions=${schedulingSummary.nearFullFutureSessionsCount}, fullFutureSessions=${schedulingSummary.fullFutureSessionsCount}.`,
  );
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

