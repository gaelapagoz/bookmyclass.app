/**
 * Performance server seed fixtures
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Mutating operation. Review target variables before running.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/performance-server-seed-fixtures.ts
 */
import {
  BillingInterval,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  PriceType,
  Role,
  ServicePricingMode,
  StudioSessionStatus,
  SubscriptionStatus,
  UserActivationStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_CREDIT_LOOKUP_KEYS,
  DEFAULT_RECURRING_LOOKUP_KEYS,
  parseLookupKeyCandidates,
  selectSingleCatalogPrice,
  selectSingleCollectiveRule,
} from "./performance-server-seed-catalog-fixtures";
import prisma from "../src/lib/db";

const TOTAL_USERS = 1200;
const COHORT_SIZE = 400;
const PASSWORD = "UAT.K6.Phase4!2026";
const EMAIL_DOMAIN = "k6-uat.bookmyclass.local";
const PHONE_PREFIX = "+320199";

const K6_SESSION_MONTHS_AHEAD = 12;
const K6_SESSIONS_PER_DAY_PER_SERVICE = 6;
const K6_DAILY_TIME_SLOTS = [
  { hour: 6, minute: 30 },
  { hour: 8, minute: 30 },
  { hour: 11, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 17, minute: 30 },
  { hour: 20, minute: 0 },
] as const;

const COHORTS = {
  entitlementCollective: "entitlement_collective",
  noEntitlement: "no_entitlement",
  subscriptionBuyer: "subscription_buyer",
} as const;

type CohortName = (typeof COHORTS)[keyof typeof COHORTS];

type SeedUser = {
  cohort: CohortName;
  email: string;
  index: number;
  name: string;
  phone: string;
};

type K6SessionTarget = {
  classTemplateId: string;
  classTypeId: string;
  durationMinutes: number;
  location: string | null;
  teacherId: string;
  title: string;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function assertUatOnlyGuard() {
  if (process.env.UAT_K6_SEED !== "1") {
    throw new Error("Refusing to run. Set UAT_K6_SEED=1 to explicitly enable UAT k6 cohort seeding.");
  }

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const urlLower = databaseUrl.toLowerCase();
  const allowDemoProductionHostSeed = process.env.CONFIRM_PROD_DEMO_K6_SEED === "YES";
  const isUatLike =
    urlLower.includes("uat") ||
    urlLower.includes("staging") ||
    urlLower.includes("localhost") ||
    urlLower.includes("127.0.0.1") ||
    allowDemoProductionHostSeed;

  if (!isUatLike) {
    throw new Error(
      "DATABASE_URL does not look like UAT/staging/local. This seed command is UAT-only and intentionally blocked. Set CONFIRM_PROD_DEMO_K6_SEED=YES only for operator-approved demo-host validation.",
    );
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatIndex(value: number): string {
  return String(value).padStart(4, "0");
}

function buildPhone(globalIndex: number): string {
  return `${PHONE_PREFIX}${String(globalIndex).padStart(4, "0")}`;
}

function buildCohortUsers(params: { cohort: CohortName; start: number; count: number }): SeedUser[] {
  const users: SeedUser[] = [];
  for (let i = 0; i < params.count; i += 1) {
    const cohortIndex = i + 1;
    const globalIndex = params.start + i;
    const indexKey = formatIndex(cohortIndex);
    const cohort = params.cohort;
    users.push({
      cohort,
      index: cohortIndex,
      email: `k6-uat-${cohort}-${indexKey}@${EMAIL_DOMAIN}`,
      name: `K6 UAT ${cohort} ${indexKey}`,
      phone: buildPhone(globalIndex),
    });
  }
  return users;
}

function buildAllUsers(): SeedUser[] {
  const entitlementUsers = buildCohortUsers({
    cohort: COHORTS.entitlementCollective,
    start: 1,
    count: COHORT_SIZE,
  });
  const noEntitlementUsers = buildCohortUsers({
    cohort: COHORTS.noEntitlement,
    start: 1 + COHORT_SIZE,
    count: COHORT_SIZE,
  });
  const subscriptionBuyerUsers = buildCohortUsers({
    cohort: COHORTS.subscriptionBuyer,
    start: 1 + COHORT_SIZE * 2,
    count: COHORT_SIZE,
  });

  const all = [...entitlementUsers, ...noEntitlementUsers, ...subscriptionBuyerUsers];
  if (all.length !== TOTAL_USERS) {
    throw new Error(`Internal seed user count mismatch. Expected ${TOTAL_USERS}, got ${all.length}.`);
  }
  return all;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addDaysUtc(base: Date, days: number): Date {
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonthsUtc(base: Date, months: number): Date {
  const next = new Date(base);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function* dateRangeByDay(startInclusive: Date, endExclusive: Date): Generator<Date> {
  for (let cursor = new Date(startInclusive); cursor < endExclusive; cursor = addDaysUtc(cursor, 1)) {
    yield cursor;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function resolveCatalogReferences() {
  const creditLookupKeys = parseLookupKeyCandidates(
    process.env.K6_CREDIT_PRICE_LOOKUP_KEYS,
    DEFAULT_CREDIT_LOOKUP_KEYS,
  );
  const recurringLookupKeys = parseLookupKeyCandidates(
    process.env.K6_RECURRING_PRICE_LOOKUP_KEYS,
    DEFAULT_RECURRING_LOOKUP_KEYS,
  );
  const allLookupKeys = [...new Set([...creditLookupKeys, ...recurringLookupKeys])];

  const prices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: allLookupKeys,
      },
      isActive: true,
      isArchived: false,
      product: {
        isActive: true,
        isArchived: false,
      },
    },
    include: {
      product: true,
    },
  });

  const collectiveCreditPrice = selectSingleCatalogPrice({
    label: "credit",
    candidateLookupKeys: creditLookupKeys,
    prices,
    expectedPriceType: PriceType.ONE_TIME,
  });
  const collectiveRecurringPrice = selectSingleCatalogPrice({
    label: "recurring",
    candidateLookupKeys: recurringLookupKeys,
    prices,
    expectedPriceType: PriceType.RECURRING,
  });

  const rules = await prisma.entitlementRule.findMany({
    where: {
      productId: {
        in: [collectiveCreditPrice.productId, collectiveRecurringPrice.productId],
      },
      isActive: true,
    },
  });

  const creditRule = selectSingleCollectiveRule({
    label: "credit",
    productId: collectiveCreditPrice.productId,
    rules,
    requiredScope: EntitlementScope.COLLECTIVE_CLASSES,
    requiredTypes: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
  });
  selectSingleCollectiveRule({
    label: "recurring",
    productId: collectiveRecurringPrice.productId,
    rules,
    requiredScope: EntitlementScope.COLLECTIVE_CLASSES,
    requiredTypes: [EntitlementType.UNLIMITED_ACCESS],
  });

  return {
    collectiveCreditPrice,
    collectiveRecurringPrice,
    creditRule,
  };
}

async function resetPreviousK6State(userIds: string[]) {
  if (!userIds.length) {
    return;
  }

  await prisma.attendanceRecord.deleteMany({
    where: {
      booking: {
        clientId: { in: userIds },
      },
    },
  });
  await prisma.waitlistEntry.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.booking.deleteMany({ where: { clientId: { in: userIds } } });

  await prisma.creditLedgerEntry.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.clientEntitlement.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.subscriptionContract.deleteMany({ where: { clientId: { in: userIds } } });

  await prisma.payment.deleteMany({
    where: {
      order: {
        clientId: { in: userIds },
      },
    },
  });
  await prisma.orderItem.deleteMany({
    where: {
      order: {
        clientId: { in: userIds },
      },
    },
  });
  await prisma.order.deleteMany({ where: { clientId: { in: userIds } } });
}

async function ensureUsers(users: SeedUser[]) {
  const passwordHash = await hash(PASSWORD, 12);
  const emailVerifiedAt = new Date("2026-04-01T00:00:00.000Z");

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: normalize(user.email) },
      update: {
        name: user.name,
        firstName: "K6",
        lastName: `${user.cohort}-${formatIndex(user.index)}`,
        role: Role.CLIENT,
        passwordHash,
        isActive: true,
        isInactive: false,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: emailVerifiedAt,
        emailVerifiedAt,
      },
      create: {
        email: normalize(user.email),
        name: user.name,
        firstName: "K6",
        lastName: `${user.cohort}-${formatIndex(user.index)}`,
        role: Role.CLIENT,
        passwordHash,
        isActive: true,
        isInactive: false,
        activationStatus: UserActivationStatus.ACTIVE,
        emailVerified: emailVerifiedAt,
        emailVerifiedAt,
      },
    });
  }

  const dbUsers = await prisma.user.findMany({
    where: {
      email: {
        in: users.map((entry) => normalize(entry.email)),
      },
    },
    select: {
      id: true,
      email: true,
      isActive: true,
      activationStatus: true,
      emailVerified: true,
      emailVerifiedAt: true,
    },
  });

  const idByEmail = new Map(dbUsers.map((entry) => [normalize(entry.email), entry.id]));
  for (const entry of dbUsers) {
    const isVerified = Boolean(entry.emailVerified || entry.emailVerifiedAt);
    if (!entry.isActive || entry.activationStatus !== UserActivationStatus.ACTIVE || !isVerified) {
      throw new Error(
        `Seeded user state mismatch for ${entry.email}. Expected active + verified user after upsert.`,
      );
    }
  }

  for (const user of users) {
    const userId = idByEmail.get(normalize(user.email));
    if (!userId) {
      throw new Error(`Failed to resolve user id for ${user.email}.`);
    }
    await prisma.clientProfile.upsert({
      where: { userId },
      update: {
        phone: user.phone,
        notes: `k6 cohort=${user.cohort} index=${formatIndex(user.index)}`,
      },
      create: {
        userId,
        phone: user.phone,
        notes: `k6 cohort=${user.cohort} index=${formatIndex(user.index)}`,
      },
    });
  }

  return idByEmail;
}

async function seedEntitlementCollectiveAccess(params: {
  users: SeedUser[];
  userIdByEmail: Map<string, string>;
  creditRule: { quantity: number | null; validForDays: number | null };
  creditPrice: { productId: string; id: string };
  recurringPrice: {
    productId: string;
    id: string;
    billingInterval: BillingInterval | null;
    billingIntervalCount: number | null;
  };
}) {
  const now = new Date();
  let creditPackUsers = 0;
  let unlimitedUsers = 0;

  for (const user of params.users) {
    const userId = params.userIdByEmail.get(normalize(user.email));
    if (!userId) {
      throw new Error(`Missing user id for entitlement user ${user.email}.`);
    }

    if (user.index % 2 === 1) {
      const expiresAt =
        params.creditRule.validForDays && params.creditRule.validForDays > 0
          ? new Date(now.getTime() + params.creditRule.validForDays * 24 * 60 * 60 * 1000)
          : null;

      const entitlement = await prisma.clientEntitlement.create({
        data: {
          clientId: userId,
          productId: params.creditPrice.productId,
          orderId: null,
          entitlementType: EntitlementType.CREDIT_PACK,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          status: ClientEntitlementStatus.ACTIVE,
          activatedAt: now,
          expiresAt,
          notes: "k6 phase4 entitlement collective credit pack",
        },
      });

      const grantAmount = params.creditRule.quantity ?? 5;
      await prisma.creditLedgerEntry.create({
        data: {
          clientId: userId,
          entitlementId: entitlement.id,
          orderId: null,
          entryType: CreditLedgerEntryType.GRANT,
          amount: grantAmount,
          happenedAt: now,
          notes: "k6 phase4 deterministic credit grant",
        },
      });
      creditPackUsers += 1;
      continue;
    }

    const intervalCount = params.recurringPrice.billingIntervalCount ?? 1;
    const periodEnd = new Date(now);
    if (params.recurringPrice.billingInterval === BillingInterval.MONTH || !params.recurringPrice.billingInterval) {
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + intervalCount);
    } else if (params.recurringPrice.billingInterval === BillingInterval.YEAR) {
      periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + intervalCount);
    } else if (params.recurringPrice.billingInterval === BillingInterval.WEEK) {
      periodEnd.setUTCDate(periodEnd.getUTCDate() + intervalCount * 7);
    } else {
      periodEnd.setUTCDate(periodEnd.getUTCDate() + intervalCount);
    }

    const contract = await prisma.subscriptionContract.create({
      data: {
        clientId: userId,
        productId: params.recurringPrice.productId,
        priceId: params.recurringPrice.id,
        status: SubscriptionStatus.ACTIVE,
        startsAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        endedAt: null,
        provider: PaymentProvider.STRIPE,
        providerSubscriptionReference: `k6_uat_sub_${formatIndex(user.index)}_${userId.slice(-8)}`,
      },
    });

    await prisma.clientEntitlement.create({
      data: {
        clientId: userId,
        productId: params.recurringPrice.productId,
        subscriptionContractId: contract.id,
        orderId: null,
        entitlementType: EntitlementType.UNLIMITED_ACCESS,
        entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
        status: ClientEntitlementStatus.ACTIVE,
        activatedAt: now,
        expiresAt: periodEnd,
        notes: "k6 phase4 entitlement collective unlimited access",
      },
    });
    unlimitedUsers += 1;
  }

  return { creditPackUsers, unlimitedUsers };
}

async function resolveK6SessionTargets(): Promise<K6SessionTarget[]> {
  const classTypes = await prisma.classType.findMany({
    where: {
      isActive: true,
      isVisible: true,
      pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
      category: {
        isActive: true,
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      defaultDurationMinutes: true,
      templates: {
        where: {
          isActive: true,
          isPublished: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
        select: {
          id: true,
          title: true,
          location: true,
          defaultDurationMinutes: true,
          defaultTeacherId: true,
        },
      },
    },
  });

  return classTypes
    .filter((entry) => !entry.slug.startsWith("seed-"))
    .map((entry) => {
      const template = entry.templates[0];
      if (!template) {
        return null;
      }
      return {
        classTemplateId: template.id,
        classTypeId: entry.id,
        durationMinutes: template.defaultDurationMinutes ?? entry.defaultDurationMinutes,
        location: template.location,
        teacherId: template.defaultTeacherId,
        title: template.title || entry.name,
      };
    })
    .filter((entry): entry is K6SessionTarget => Boolean(entry));
}

async function seedFutureSessionsForK6() {
  const targets = await resolveK6SessionTargets();
  if (!targets.length) {
    throw new Error("No active SINGLE_OR_PLAN class templates found for UAT k6 session seeding.");
  }

  const now = new Date();
  const startDate = addDaysUtc(startOfUtcDay(now), 1);
  const endDate = addMonthsUtc(startDate, K6_SESSION_MONTHS_AHEAD);

  const sessionRows: Array<{
    classTemplateId: string;
    classTypeId: string;
    teacherId: string;
    title: string;
    description: string;
    location: string | null;
    startsAt: Date;
    endsAt: Date;
    capacity: number;
    status: StudioSessionStatus;
    isPublished: boolean;
  }> = [];

  for (const [serviceIndex, target] of targets.entries()) {
    for (const day of dateRangeByDay(startDate, endDate)) {
      for (let slotIndex = 0; slotIndex < K6_SESSIONS_PER_DAY_PER_SERVICE; slotIndex += 1) {
        const slot = K6_DAILY_TIME_SLOTS[slotIndex % K6_DAILY_TIME_SLOTS.length]!;
        const startsAt = new Date(
          Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), slot.hour, slot.minute, 0, 0),
        );
        startsAt.setUTCMinutes(startsAt.getUTCMinutes() + serviceIndex);
        if (startsAt <= now) {
          continue;
        }

        const endsAt = new Date(startsAt);
        endsAt.setUTCMinutes(endsAt.getUTCMinutes() + target.durationMinutes);

        sessionRows.push({
          classTemplateId: target.classTemplateId,
          classTypeId: target.classTypeId,
          teacherId: target.teacherId,
          title: target.title,
          description: "UAT k6 deterministic future session inventory",
          location: target.location,
          startsAt,
          endsAt,
          capacity: 24,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        });
      }
    }
  }

  for (const batch of chunk(sessionRows, 1500)) {
    await prisma.studioSession.createMany({
      data: batch,
      skipDuplicates: true,
    });
  }

  return {
    serviceCount: targets.length,
    sessionRows: sessionRows.length,
    startDate,
    endDate,
  };
}

async function exportK6Csv(users: SeedUser[]) {
  const csvPath = resolve(
    process.cwd(),
    process.env.K6_USERS_CSV_PATH?.trim() || "k6/data/users.csv",
  );
  await mkdir(dirname(csvPath), { recursive: true });

  const header = ["email", "password", "name", "phone", "cohort"];
  const lines = [header.join(",")];
  for (const user of users) {
    lines.push(
      [
        csvEscape(normalize(user.email)),
        csvEscape(PASSWORD),
        csvEscape(user.name),
        csvEscape(user.phone),
        csvEscape(user.cohort),
      ].join(","),
    );
  }

  await writeFile(csvPath, `${lines.join("\n")}\n`, "utf8");
  return csvPath;
}

async function main() {
  assertUatOnlyGuard();

  const users = buildAllUsers();
  const entitlementUsers = users.filter((user) => user.cohort === COHORTS.entitlementCollective);
  const noEntitlementUsers = users.filter((user) => user.cohort === COHORTS.noEntitlement);
  const subscriptionBuyerUsers = users.filter((user) => user.cohort === COHORTS.subscriptionBuyer);

  const { collectiveCreditPrice, collectiveRecurringPrice, creditRule } = await resolveCatalogReferences();
  const userIdByEmail = await ensureUsers(users);
  await resetPreviousK6State([...userIdByEmail.values()]);

  const accessSeedResult = await seedEntitlementCollectiveAccess({
    users: entitlementUsers,
    userIdByEmail,
    creditRule: {
      quantity: creditRule.quantity ?? 5,
      validForDays: creditRule.validForDays ?? 90,
    },
    creditPrice: {
      productId: collectiveCreditPrice.productId,
      id: collectiveCreditPrice.id,
    },
    recurringPrice: {
      productId: collectiveRecurringPrice.productId,
      id: collectiveRecurringPrice.id,
      billingInterval: collectiveRecurringPrice.billingInterval,
      billingIntervalCount: collectiveRecurringPrice.billingIntervalCount,
    },
  });

  const sessionSeedResult = await seedFutureSessionsForK6();
  const csvPath = await exportK6Csv(users);

  console.info("[k6-uat-seed] complete");
  console.info(`[k6-uat-seed] users total=${users.length}`);
  console.info(
    `[k6-uat-seed] cohorts entitlement_collective=${entitlementUsers.length}, no_entitlement=${noEntitlementUsers.length}, subscription_buyer=${subscriptionBuyerUsers.length}`,
  );
  console.info(
    `[k6-uat-seed] entitlement_collective distribution credit_pack=${accessSeedResult.creditPackUsers}, monthly_unlimited=${accessSeedResult.unlimitedUsers}`,
  );
  console.info(
    `[k6-uat-seed] sessions seeded services=${sessionSeedResult.serviceCount}, rows=${sessionSeedResult.sessionRows}, range=${sessionSeedResult.startDate.toISOString()}..${sessionSeedResult.endDate.toISOString()}`,
  );
  console.info(`[k6-uat-seed] csv exported=${csvPath}`);
  console.info(`[k6-uat-seed] credentials password=${PASSWORD}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("[k6-uat-seed] failed", error);
    await prisma.$disconnect();
    process.exit(1);
  });
