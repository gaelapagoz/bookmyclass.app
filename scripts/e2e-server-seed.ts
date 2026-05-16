/**
 * E2e server seed
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
 *   tsx scripts/e2e-server-seed.ts
 */
import {
  BookingStatus,
  ClientMessageContactStatus,
  ClientMessageStatus,
  ClientMessageType,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  MarketingAudienceType,
  MarketingCampaignStatus,
  MarketingSubscriptionStatus,
  PriceType,
  ProductType,
  Role,
  StripeSyncStatus,
  StudioSessionStatus,
  SubscriptionStatus,
  UserActivationStatus,
  UserCreatedVia,
} from "@prisma/client";
import { hash } from "bcryptjs";
import prisma from "../src/lib/db";
import { runDevelopmentSeed } from "../prisma/seed/modes/development";
import {
  SEEDED_CANONICAL_EMAILS,
  SEEDED_EMAIL_DOMAIN,
  SEEDED_USER_PASSWORD,
} from "../prisma/seed/seed-credentials";

const E2E_DEV_BASELINE_STRIPE_PRICE_ENV_DEFAULTS: Record<string, string> = {
  STRIPE_PRICE_ID_COLLECTIVE_DROP_IN: "price_E2eCollectiveDropIn",
  STRIPE_PRICE_ID_COLLECTIVE_5_PACK: "price_E2eCollectiveFivePack",
  STRIPE_PRICE_ID_COLLECTIVE_10_PACK: "price_E2eCollectiveTenPack",
  STRIPE_PRICE_ID_MONTHLY_UNLIMITED_COLLECTIVE: "price_E2eMonthlyUnlimited",
  STRIPE_PRICE_ID_PRIVATE_5_PACK: "price_E2ePrivateFivePack",
  STRIPE_PRICE_ID_PRIVATE_10_PACK: "price_E2ePrivateTenPack",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_25_EUR: "price_E2eStoreGiftCard25",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_50_EUR: "price_E2eStoreGiftCard50",
  STRIPE_PRICE_ID_STORE_GIFT_CARD_100_EUR: "price_E2eStoreGiftCard100",
  STRIPE_PRICE_ID_STORE_MERCH_YOGA_MAT: "price_E2eStoreYogaMat",
  STRIPE_PRICE_ID_STORE_MERCH_RESISTANCE_BANDS: "price_E2eStoreResistanceBands",
  STRIPE_PRICE_ID_STORE_MERCH_STUDIO_TOTE: "price_E2eStoreStudioTote",
};

function ensureE2EDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!databaseUrl.toLowerCase().includes("e2e")) {
    throw new Error("E2E seed requires DATABASE_URL containing 'e2e'.");
  }
}

function ensureDevelopmentBaselineSeedEnv() {
  for (const [key, value] of Object.entries(E2E_DEV_BASELINE_STRIPE_PRICE_ENV_DEFAULTS)) {
    process.env[key] ||= value;
  }
}

async function resetE2EDatabase() {
  await prisma.marketingCampaignGenerationUsage.deleteMany();
  await prisma.marketingCampaignLinkClick.deleteMany();
  await prisma.marketingCampaignLink.deleteMany();
  await prisma.marketingCampaignRecipient.deleteMany();
  await prisma.marketingCampaign.deleteMany();
  await prisma.marketingUnsubscribe.deleteMany();
  await prisma.marketingUserSegment.deleteMany();
  await prisma.marketingSegment.deleteMany();
  await prisma.marketingCategory.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.siteWeeklyScheduleEntry.deleteMany();
  await prisma.studioSession.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.classType.deleteMany();
  await prisma.classCategory.deleteMany();
  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.giftCardReconciliationCase.deleteMany();
  await prisma.giftCardLedgerEntry.deleteMany();
  await prisma.giftCardRedemption.deleteMany();
  await prisma.giftCardWallet.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.clientEntitlement.deleteMany();
  await prisma.cartCheckoutIdempotency.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.giftCardCode.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.adminNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contactMessage.deleteMany();
  await prisma.clientMessage.deleteMany();
  await prisma.learningCourse.deleteMany();
  await prisma.learningProgram.deleteMany();
  await prisma.contactMessageRateLimit.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionContract.deleteMany();
  await prisma.entitlementRule.deleteMany();
  await prisma.price.deleteMany();
  await prisma.product.deleteMany();
  await prisma.clientProfile.deleteMany();
  await prisma.teacherProfile.deleteMany();
  await prisma.account.deleteMany();
  await prisma.session.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.passwordResetRateLimit.deleteMany();
  await prisma.publicAuthRateLimit.deleteMany();
  await prisma.adminLoginAbuseCounter.deleteMany();
  await prisma.bookingPolicy.deleteMany();
  await prisma.publicDocument.deleteMany();
  await prisma.mediaAsset.deleteMany();
  await prisma.pendingUserRegistration.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
}

async function main() {
  ensureE2EDatabaseUrl();
  ensureDevelopmentBaselineSeedEnv();
  await resetE2EDatabase();
  await runDevelopmentSeed();

  const passwordHash = await hash(SEEDED_USER_PASSWORD, 12);
  const now = new Date();
  const entitlementExpiry = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  const startsAtA = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  startsAtA.setHours(10, 0, 0, 0);
  const endsAtA = new Date(startsAtA.getTime() + 60 * 60 * 1000);
  const startsAtB = new Date(now.getTime() + 96 * 60 * 60 * 1000);
  startsAtB.setHours(12, 0, 0, 0);
  const endsAtB = new Date(startsAtB.getTime() + 60 * 60 * 1000);

  const admin = await prisma.user.create({
    data: {
      name: "E2E Admin",
      firstName: "E2E",
      lastName: "Admin",
      email: SEEDED_CANONICAL_EMAILS.e2eAdmin,
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
    },
  });

  const teacher = await prisma.user.create({
    data: {
      name: "E2E Teacher",
      firstName: "E2E",
      lastName: "Teacher",
      email: SEEDED_CANONICAL_EMAILS.teacher,
      passwordHash,
      role: Role.TEACHER,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
      teacherProfile: {
        create: {
          phone: "+32000000001",
          bio: "E2E seeded teacher profile",
          specialties: ["Pilates"],
          certifications: ["Level 1"],
        },
      },
    },
  });

  const clientWithCredits = await prisma.user.create({
    data: {
      name: "E2E Client Credits",
      firstName: "E2E",
      lastName: "Credits",
      email: SEEDED_CANONICAL_EMAILS.e2eClient,
      passwordHash,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
      marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      clientProfile: {
        create: {
          phone: "+32000000002",
        },
      },
    },
  });

  const clientNoCredits = await prisma.user.create({
    data: {
      name: "E2E Client No Credits",
      firstName: "E2E",
      lastName: "NoCredits",
      email: `e2e-client-nocredits@${SEEDED_EMAIL_DOMAIN}`,
      passwordHash,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
      marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      clientProfile: {
        create: {
          phone: "+32000000003",
        },
      },
    },
  });

  const smokeClient = await prisma.user.create({
    data: {
      name: "E2E Smoke Client",
      firstName: "E2E",
      lastName: "Smoke",
      email: `e2e-client-smoke@${SEEDED_EMAIL_DOMAIN}`,
      passwordHash,
      role: Role.CLIENT,
      isActive: true,
      isInactive: false,
      activationStatus: UserActivationStatus.ACTIVE,
      createdVia: UserCreatedVia.IMPORT,
      emailVerified: now,
      emailVerifiedAt: now,
      marketingSubscriptionStatus: MarketingSubscriptionStatus.SUBSCRIBED,
      clientProfile: {
        create: {
          phone: "+32000000004",
        },
      },
    },
  });

  await prisma.bookingPolicy.upsert({
    where: {
      scope: "GLOBAL",
    },
    update: {
      cancellationCutoffHours: 24,
    },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: 24,
    },
  });

  const category = await prisma.classCategory.create({
    data: {
      name: "Collective Classes",
      slug: "collective-classes",
      description: "Collective classes for e2e.",
      isActive: true,
      sortOrder: 0,
    },
  });

  const classType = await prisma.classType.create({
    data: {
      categoryId: category.id,
      name: "E2E Flow Class",
      slug: "e2e-flow-class",
      description: "E2E bookable service",
      defaultDurationMinutes: 60,
      defaultCapacity: 12,
      isActive: true,
      isVisible: true,
      sortOrder: 0,
      serviceScope: EntitlementScope.COLLECTIVE_CLASSES,
    },
  });

  const template = await prisma.classTemplate.create({
    data: {
      classTypeId: classType.id,
      defaultTeacherId: teacher.id,
      title: "E2E Flow Class Template",
      slug: "e2e-flow-class-template",
      description: "Template for deterministic e2e sessions.",
      location: "E2E Studio",
      defaultCapacity: 12,
      defaultDurationMinutes: 60,
      isActive: true,
      isPublished: true,
    },
  });

  await prisma.studioSession.createMany({
    data: [
      {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: teacher.id,
        title: "E2E Session A",
        description: "Deterministic future session A",
        location: "E2E Studio",
        startsAt: startsAtA,
        endsAt: endsAtA,
        capacity: 12,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
      {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: teacher.id,
        title: "E2E Session B",
        description: "Deterministic future session B",
        location: "E2E Studio",
        startsAt: startsAtB,
        endsAt: endsAtB,
        capacity: 12,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
    ],
  });

  const singleProduct = await prisma.product.create({
    data: {
      name: "E2E Drop In",
      slug: "e2e-drop-in",
      description: "Single drop-in booking product for e2e.",
      productType: ProductType.DROP_IN_CLASS,
      isActive: true,
      isArchived: false,
      sortOrder: 1,
      prices: {
        create: {
          lookupKey: "e2e-drop-in-eur-once-v1",
          stripePriceId: "price_e2e_drop_in_v1",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          name: "E2E Drop In One-Time",
          priceType: PriceType.ONE_TIME,
          currencyCode: "EUR",
          unitAmountMinor: 2000,
          isActive: true,
          isArchived: false,
        },
      },
      entitlementRules: {
        create: {
          entitlementType: EntitlementType.SINGLE_USE,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          quantity: 1,
          isActive: true,
        },
      },
    },
    include: {
      prices: true,
    },
  });

  const packProduct = await prisma.product.create({
    data: {
      name: "E2E 5-Class Pack",
      slug: "e2e-5-class-pack",
      description: "Five collective credits for e2e.",
      productType: ProductType.CLASS_PACK,
      isActive: true,
      isArchived: false,
      sortOrder: 2,
      prices: {
        create: {
          lookupKey: "e2e-5-pack-eur-once-v1",
          stripePriceId: "price_e2e_pack_5_v1",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          name: "E2E 5-Class Pack",
          priceType: PriceType.ONE_TIME,
          currencyCode: "EUR",
          unitAmountMinor: 8000,
          isActive: true,
          isArchived: false,
        },
      },
      entitlementRules: {
        create: {
          entitlementType: EntitlementType.CREDIT_PACK,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          quantity: 5,
          validForDays: 180,
          isActive: true,
        },
      },
    },
    include: {
      prices: true,
    },
  });

  const recurringProduct = await prisma.product.create({
    data: {
      name: "E2E Monthly Unlimited",
      slug: "e2e-monthly-unlimited",
      description: "Recurring unlimited membership for e2e.",
      productType: ProductType.UNLIMITED_MEMBERSHIP,
      isActive: true,
      isArchived: false,
      sortOrder: 3,
      prices: {
        create: {
          lookupKey: "e2e-monthly-unlimited-eur-monthly-v1",
          stripePriceId: "price_e2e_monthly_unlimited_v1",
          stripeSyncStatus: StripeSyncStatus.SYNCED,
          name: "E2E Monthly Unlimited",
          priceType: PriceType.RECURRING,
          currencyCode: "EUR",
          unitAmountMinor: 12000,
          billingInterval: "MONTH",
          billingIntervalCount: 1,
          isActive: true,
          isArchived: false,
        },
      },
      entitlementRules: {
        create: {
          entitlementType: EntitlementType.UNLIMITED_ACCESS,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          isActive: true,
        },
      },
    },
    include: {
      prices: true,
    },
  });

  const seededPackEntitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: clientWithCredits.id,
      productId: packProduct.id,
      orderId: null,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: now,
      expiresAt: entitlementExpiry,
      notes: "Seeded e2e entitlement",
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId: clientWithCredits.id,
      entitlementId: seededPackEntitlement.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 5,
      notes: "Seeded e2e credits",
      idempotencyKey: "e2e-seed-credit-grant-client-with-credits",
    },
  });

  await prisma.clientEntitlement.create({
    data: {
      clientId: clientWithCredits.id,
      productId: recurringProduct.id,
      orderId: null,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: now,
      notes: "Seeded e2e unlimited access",
    },
  });

  await prisma.clientMessage.create({
    data: {
      type: ClientMessageType.CONTACT,
      userId: clientWithCredits.id,
      bookingId: null,
      name: "E2E Inbox Client",
      email: `e2e-inbox@${SEEDED_EMAIL_DOMAIN}`,
      phone: "+32000009999",
      subject: "E2E Inbox Message",
      message: "Seeded inbox message for e2e admin review flow.",
      status: ClientMessageStatus.NEW,
      contactStatus: ClientMessageContactStatus.INBOX,
    },
  });

  await prisma.learningProgram.create({
    data: {
      legacyId: "e2e-program-v1",
      mainTitle: "E2E Online Learning Program",
      mainDescription: "Program used for e2e navigation coverage.",
      courseType: "e2e_course_type",
      title: "E2E Program",
      description1: "Step-by-step mobility class",
      description2: "Focus on deterministic fixtures",
      description3: "Stable for e2e",
      videoPromo: "https://example.test/e2e-promo",
      picture1: "/images/learning/online-yoga-image-1.jpg",
      picture2: "/images/learning/backbend-image-1.jpg",
      picture3: "/images/learning/backbend-image-3.jpg",
    },
  });

  await prisma.learningCourse.create({
    data: {
      legacyId: "e2e-course-1",
      title: "E2E Course Video",
      description: "E2E seeded learning video",
      shortDescription: "E2E video",
      category: "e2e_course_type",
      categoryType: "Beginner",
      categoryLevel: "1",
      thumbnail: "/images/learning/01-how-to-use-this-course.jpg",
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      priority: 1,
    },
  });

  await prisma.marketingCampaign.create({
    data: {
      id: "e2e-marketing-campaign",
      name: "E2E Marketing Campaign",
      status: MarketingCampaignStatus.DRAFT,
      audienceType: MarketingAudienceType.ALL_USERS,
      manualAudienceJson: {
        emails: [],
        userIds: [],
        flow: {
          currentStep: "STEP_4",
          selectedSegmentIds: [],
        },
      },
      subject: "E2E Campaign Subject",
      previewText: "E2E campaign preview",
      fromName: "BookMyClass E2E",
      fromEmail: `marketing@${SEEDED_EMAIL_DOMAIN}`,
      replyTo: `support@${SEEDED_EMAIL_DOMAIN}`,
      contentJson: {
        blocks: [
          { type: "heading", text: "E2E Campaign" },
          { type: "paragraph", text: "Seeded campaign content for deterministic e2e flow." },
        ],
      },
      createdById: admin.id,
    },
  });

  const recurringPrice = recurringProduct.prices[0];
  const singlePrice = singleProduct.prices[0];
  const packPrice = packProduct.prices[0];

  console.info("[e2e-seed] completed", {
    adminEmail: admin.email,
    teacherEmail: teacher.email,
    clientWithCreditsEmail: clientWithCredits.email,
    clientNoCreditsEmail: clientNoCredits.email,
    smokeClientEmail: smokeClient.email,
    serviceSlug: classType.slug,
    recurringPriceId: recurringPrice?.id ?? null,
    recurringStripePriceId: recurringPrice?.stripePriceId ?? null,
    singlePriceId: singlePrice?.id ?? null,
    packPriceId: packPrice?.id ?? null,
    samplePassword: "[redacted]",
    seededMembershipStatus: SubscriptionStatus.ACTIVE,
    seededBookingStatus: BookingStatus.CONFIRMED,
  });
}

main()
  .catch((error) => {
    console.error("[e2e-seed] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




