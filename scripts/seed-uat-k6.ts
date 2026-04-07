import {
  BillingInterval,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  PaymentProvider,
  Role,
  SubscriptionStatus,
  UserActivationStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import prisma from "../src/lib/db";

const TOTAL_USERS = 1200;
const COHORT_SIZE = 400;
const PASSWORD = "UAT.K6.Phase4!2026";
const EMAIL_DOMAIN = "k6-uat.bookmyclass.local";
const PHONE_PREFIX = "+320199";

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
  const isUatLike =
    urlLower.includes("uat") ||
    urlLower.includes("staging") ||
    urlLower.includes("localhost") ||
    urlLower.includes("127.0.0.1");

  if (!isUatLike) {
    throw new Error(
      "DATABASE_URL does not look like UAT/staging/local. This seed command is UAT-only and intentionally blocked.",
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

async function resolveCatalogReferences() {
  const prices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: ["qa-collective-5-pack-eur-once-v1", "monthly-unlimited-collective-eur-monthly-v1"],
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

  const priceByLookup = new Map(prices.map((price) => [price.lookupKey, price]));
  const collectiveCreditPrice = priceByLookup.get("qa-collective-5-pack-eur-once-v1");
  const collectiveRecurringPrice = priceByLookup.get("monthly-unlimited-collective-eur-monthly-v1");

  if (!collectiveCreditPrice || !collectiveRecurringPrice) {
    throw new Error(
      "Required catalog prices were not found. Run base seed first to ensure collective products/prices exist.",
    );
  }

  const rules = await prisma.entitlementRule.findMany({
    where: {
      productId: {
        in: [collectiveCreditPrice.productId, collectiveRecurringPrice.productId],
      },
      isActive: true,
    },
  });

  const creditRule = rules.find(
    (rule) =>
      rule.productId === collectiveCreditPrice.productId &&
      rule.entitlementScope === EntitlementScope.COLLECTIVE_CLASSES &&
      (rule.entitlementType === EntitlementType.CREDIT_PACK || rule.entitlementType === EntitlementType.SINGLE_USE),
  );
  const unlimitedRule = rules.find(
    (rule) =>
      rule.productId === collectiveRecurringPrice.productId &&
      rule.entitlementScope === EntitlementScope.COLLECTIVE_CLASSES &&
      rule.entitlementType === EntitlementType.UNLIMITED_ACCESS,
  );

  if (!creditRule || !unlimitedRule) {
    throw new Error("Required entitlement rules for collective access were not found in catalog.");
  }

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
    },
  });

  const idByEmail = new Map(dbUsers.map((entry) => [normalize(entry.email), entry.id]));
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

  const csvPath = await exportK6Csv(users);

  console.info("[k6-uat-seed] complete");
  console.info(`[k6-uat-seed] users total=${users.length}`);
  console.info(
    `[k6-uat-seed] cohorts entitlement_collective=${entitlementUsers.length}, no_entitlement=${noEntitlementUsers.length}, subscription_buyer=${subscriptionBuyerUsers.length}`,
  );
  console.info(
    `[k6-uat-seed] entitlement_collective distribution credit_pack=${accessSeedResult.creditPackUsers}, monthly_unlimited=${accessSeedResult.unlimitedUsers}`,
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
