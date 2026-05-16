import {
  EntitlementScope,
  PriceType,
  ProductType,
  Role,
  ServicePricingMode,
  StripeSyncStatus,
  StudioSessionStatus,
  UserActivationStatus,
} from "@prisma/client";
import { hash } from "bcryptjs";
import prisma from "../src/lib/db";

function requiredEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required env var. One of: ${names.join(", ")}`);
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "***";
  const left = local.slice(0, 2);
  return `${left}***@${domain}`;
}

function assertSafetyGuards() {
  if (process.env.UAT_E2E_SEED !== "1") {
    throw new Error("Refusing to run. Set UAT_E2E_SEED=1 to explicitly enable staging E2E seed.");
  }
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const lower = databaseUrl.toLowerCase();
  const isUatLike =
    lower.includes("uat") ||
    lower.includes("staging") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1");
  if (!isUatLike) {
    throw new Error("DATABASE_URL does not look like staging/UAT/local. Refusing staging E2E seed.");
  }
}

async function ensureUser(params: {
  email: string;
  password: string;
  role: Role;
  firstName: string;
  lastName: string;
}) {
  const passwordHash = await hash(params.password, 12);
  const now = new Date();
  const email = normalizeEmail(params.email);
  const fullName = `${params.firstName} ${params.lastName}`.trim();

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: fullName,
      firstName: params.firstName,
      lastName: params.lastName,
      role: params.role,
      passwordHash,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: now,
      emailVerifiedAt: now,
    },
    create: {
      email,
      name: fullName,
      firstName: params.firstName,
      lastName: params.lastName,
      role: params.role,
      passwordHash,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });

  return user;
}

async function ensureCatalog() {
  const subscriptionProduct = await prisma.product.upsert({
    where: { slug: "staging-e2e-monthly-unlimited" },
    update: {
      name: "Staging E2E Monthly Unlimited",
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
    },
    create: {
      slug: "staging-e2e-monthly-unlimited",
      name: "Staging E2E Monthly Unlimited",
      description: "Idempotent staging E2E subscription fixture.",
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 9801,
    },
  });

  await prisma.price.upsert({
    where: { lookupKey: "staging-e2e-monthly-unlimited-eur-month-v1" },
    update: {
      productId: subscriptionProduct.id,
      name: "Staging E2E Monthly Unlimited",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 8900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
    create: {
      productId: subscriptionProduct.id,
      lookupKey: "staging-e2e-monthly-unlimited-eur-month-v1",
      name: "Staging E2E Monthly Unlimited",
      priceType: PriceType.RECURRING,
      currencyCode: "EUR",
      unitAmountMinor: 8900,
      billingInterval: "MONTH",
      billingIntervalCount: 1,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
  });

  const giftCardProduct = await prisma.product.upsert({
    where: { slug: "staging-e2e-gift-card-50" },
    update: { isActive: true, isArchived: false },
    create: {
      slug: "staging-e2e-gift-card-50",
      name: "Staging E2E Gift Card 50",
      description: "Idempotent staging E2E store fixture.",
      productType: ProductType.GIFT_CARD,
      isActive: true,
      isArchived: false,
      sortOrder: 9802,
    },
  });

  await prisma.price.upsert({
    where: { lookupKey: "staging-e2e-gift-card-50-eur-v1" },
    update: {
      productId: giftCardProduct.id,
      name: "Staging E2E Gift Card 50",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
    create: {
      productId: giftCardProduct.id,
      lookupKey: "staging-e2e-gift-card-50-eur-v1",
      name: "Staging E2E Gift Card 50",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 5000,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
  });

  const merchProduct = await prisma.product.upsert({
    where: { slug: "staging-e2e-merch-mat" },
    update: { isActive: true, isArchived: false },
    create: {
      slug: "staging-e2e-merch-mat",
      name: "Staging E2E Yoga Mat",
      description: "Idempotent staging E2E store fixture.",
      productType: ProductType.MERCHANDISE,
      isActive: true,
      isArchived: false,
      sortOrder: 9803,
    },
  });

  await prisma.price.upsert({
    where: { lookupKey: "staging-e2e-merch-mat-eur-v1" },
    update: {
      productId: merchProduct.id,
      name: "Staging E2E Yoga Mat",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2900,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
    create: {
      productId: merchProduct.id,
      lookupKey: "staging-e2e-merch-mat-eur-v1",
      name: "Staging E2E Yoga Mat",
      priceType: PriceType.ONE_TIME,
      currencyCode: "EUR",
      unitAmountMinor: 2900,
      isActive: true,
      isArchived: false,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    },
  });
}

async function ensureBookableSession() {
  const teacher = await ensureUser({
    email: process.env.UAT_E2E_TEACHER_EMAIL?.trim() || "staging-e2e-teacher@bookmyclass.local",
    password: process.env.UAT_E2E_TEACHER_PASSWORD?.trim() || "Staging.E2E.Teacher.123!",
    role: Role.TEACHER,
    firstName: "Staging",
    lastName: "Teacher",
  });

  const category = await prisma.classCategory.upsert({
    where: { slug: "staging-e2e-collective" },
    update: { isActive: true, name: "Staging E2E Collective" },
    create: {
      slug: "staging-e2e-collective",
      name: "Staging E2E Collective",
      description: "Idempotent staging E2E class category.",
      isActive: true,
      sortOrder: 9801,
    },
  });

  const classType = await prisma.classType.upsert({
    where: { slug: "staging-e2e-flow-class" },
    update: {
      categoryId: category.id,
      isActive: true,
      isVisible: true,
      pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
      serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    },
    create: {
      categoryId: category.id,
      name: "Staging E2E Flow Class",
      slug: "staging-e2e-flow-class",
      description: "Idempotent staging E2E class type.",
      defaultDurationMinutes: 60,
      defaultCapacity: 12,
      isActive: true,
      isVisible: true,
      pricingMode: ServicePricingMode.SINGLE_OR_PLAN,
      serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
      sortOrder: 9801,
    },
  });

  const template = await prisma.classTemplate.upsert({
    where: { slug: "staging-e2e-flow-template" },
    update: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      isActive: true,
      isPublished: true,
    },
    create: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "Staging E2E Flow Template",
      slug: "staging-e2e-flow-template",
      description: "Idempotent staging E2E class template.",
      location: "Staging E2E Studio",
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  const now = new Date();
  const futureSessions = await prisma.studioSession.count({
    where: {
      classTypeId: classType.id,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      startsAt: { gt: now },
    },
  });

  if (futureSessions < 2) {
    const startA = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    startA.setUTCMinutes(0, 0, 0);
    const endA = new Date(startA.getTime() + 60 * 60 * 1000);
    const startB = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    startB.setUTCMinutes(0, 0, 0);
    const endB = new Date(startB.getTime() + 60 * 60 * 1000);

    await prisma.studioSession.createMany({
      data: [
        {
          classTemplateId: template.id,
          classTypeId: classType.id,
          teacherId: teacher.id,
          title: "Staging E2E Session A",
          description: "Idempotent staging E2E future session A.",
          location: "Staging E2E Studio",
          startsAt: startA,
          endsAt: endA,
          capacity: 12,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
        {
          classTemplateId: template.id,
          classTypeId: classType.id,
          teacherId: teacher.id,
          title: "Staging E2E Session B",
          description: "Idempotent staging E2E future session B.",
          location: "Staging E2E Studio",
          startsAt: startB,
          endsAt: endB,
          capacity: 12,
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
      ],
    });
  }
}

async function main() {
  assertSafetyGuards();
  const clientEmail = requiredEnv(["UAT_E2E_CLIENT_EMAIL", "UAT_E2E_EMAIL"]);
  const clientPassword = requiredEnv(["UAT_E2E_CLIENT_PASSWORD", "UAT_E2E_PASSWORD"]);
  const adminEmail = requiredEnv(["UAT_E2E_ADMIN_EMAIL"]);
  const adminPassword = requiredEnv(["UAT_E2E_ADMIN_PASSWORD"]);

  const client = await ensureUser({
    email: clientEmail,
    password: clientPassword,
    role: Role.CLIENT,
    firstName: "Staging",
    lastName: "Client",
  });

  await prisma.clientProfile.upsert({
    where: { userId: client.id },
    update: { phone: "+32000019999", notes: "Staging E2E idempotent client profile" },
    create: { userId: client.id, phone: "+32000019999", notes: "Staging E2E idempotent client profile" },
  });

  await ensureUser({
    email: adminEmail,
    password: adminPassword,
    role: Role.ADMIN,
    firstName: "Staging",
    lastName: "Admin",
  });

  await ensureCatalog();
  await ensureBookableSession();

  console.info("[staging-e2e-seed] completed");
  console.info(`[staging-e2e-seed] client=${maskEmail(clientEmail)} ready`);
  console.info(`[staging-e2e-seed] admin=${maskEmail(adminEmail)} ready`);
}

main()
  .catch((error) => {
    console.error("[staging-e2e-seed] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
