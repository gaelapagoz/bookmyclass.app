import { PrismaPg } from "@prisma/adapter-pg";
import {
  AttendanceStatus,
  BillingInterval,
  BookingStatus,
  ClientEntitlementStatus,
  ContactMessageStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  LoyaltyLedgerEntryType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  PriceType,
  PrismaClient,
  ProductType,
  Role,
  ServicePricingMode,
  SubscriptionStatus,
  StudioSessionStatus,
  WaitlistStatus,
  Weekday,
} from "@prisma/client";
import { hash } from "bcryptjs";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const pool = new Pool({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const SCHEDULE_WINDOW_START = new Date("2026-04-01T00:00:00.000Z");
const SCHEDULE_WINDOW_END = new Date("2026-05-15T23:59:59.000Z");
const SCHEDULE_BLACKOUT_DATES = new Set(["2026-04-12", "2026-05-01"]);

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

    if (startsAt >= windowStart) {
      result.push(startsAt);
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
}

async function seedMasterAdmin() {
  const passwordHash = await hash("MasterAdmin123!", 12);

  return prisma.user.upsert({
    where: { email: "masteradmin@onthematstudio.local" },
    update: {
      name: "Master Admin",
      role: Role.MASTER_ADMIN,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-20T08:00:00.000Z"),
    },
    create: {
      email: "masteradmin@onthematstudio.local",
      name: "Master Admin",
      role: Role.MASTER_ADMIN,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-20T08:00:00.000Z"),
    },
  });
}

async function seedTeacher() {
  const passwordHash = await hash("Teacher123!", 12);

  return prisma.user.upsert({
    where: { email: "teacher@onthematstudio.local" },
    update: {
      name: "Teacher User",
      role: Role.TEACHER,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-18T09:30:00.000Z"),
      teacherProfile: {
        upsert: {
          update: {
            phone: "+32000000001",
            dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
            emergencyContactName: "Teacher Emergency Contact",
            emergencyContactPhone: "+32000000099",
            bio: "Muay Thai and functional conditioning coach.",
            specialties: ["muay-thai", "conditioning"],
            certifications: ["ISSA CPT", "First Aid"],
            hireDate: new Date("2022-09-01T00:00:00.000Z"),
          },
          create: {
            phone: "+32000000001",
            dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
            emergencyContactName: "Teacher Emergency Contact",
            emergencyContactPhone: "+32000000099",
            bio: "Muay Thai and functional conditioning coach.",
            specialties: ["muay-thai", "conditioning"],
            certifications: ["ISSA CPT", "First Aid"],
            hireDate: new Date("2022-09-01T00:00:00.000Z"),
          },
        },
      },
    },
    create: {
      email: "teacher@onthematstudio.local",
      name: "Teacher User",
      role: Role.TEACHER,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-18T09:30:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000001",
          dateOfBirth: new Date("1990-05-10T00:00:00.000Z"),
          emergencyContactName: "Teacher Emergency Contact",
          emergencyContactPhone: "+32000000099",
          bio: "Muay Thai and functional conditioning coach.",
          specialties: ["muay-thai", "conditioning"],
          certifications: ["ISSA CPT", "First Aid"],
          hireDate: new Date("2022-09-01T00:00:00.000Z"),
        },
      },
    },
  });
}

async function seedAssistantTeacher() {
  const passwordHash = await hash("Assistant123!", 12);

  return prisma.user.upsert({
    where: { email: "assistant.teacher@onthematstudio.local" },
    update: {
      name: "Assistant Teacher",
      role: Role.TEACHER,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-17T11:00:00.000Z"),
      teacherProfile: {
        upsert: {
          update: {
            phone: "+32000000003",
            dateOfBirth: new Date("1992-04-15T00:00:00.000Z"),
            emergencyContactName: "Assistant Emergency Contact",
            emergencyContactPhone: "+32000000097",
            bio: "Mobility and fundamentals specialist.",
            specialties: ["mobility", "fundamentals"],
            certifications: ["NASM CPT"],
            hireDate: new Date("2024-01-10T00:00:00.000Z"),
          },
          create: {
            phone: "+32000000003",
            dateOfBirth: new Date("1992-04-15T00:00:00.000Z"),
            emergencyContactName: "Assistant Emergency Contact",
            emergencyContactPhone: "+32000000097",
            bio: "Mobility and fundamentals specialist.",
            specialties: ["mobility", "fundamentals"],
            certifications: ["NASM CPT"],
            hireDate: new Date("2024-01-10T00:00:00.000Z"),
          },
        },
      },
    },
    create: {
      email: "assistant.teacher@onthematstudio.local",
      name: "Assistant Teacher",
      role: Role.TEACHER,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-17T11:00:00.000Z"),
      teacherProfile: {
        create: {
          phone: "+32000000003",
          dateOfBirth: new Date("1992-04-15T00:00:00.000Z"),
          emergencyContactName: "Assistant Emergency Contact",
          emergencyContactPhone: "+32000000097",
          bio: "Mobility and fundamentals specialist.",
          specialties: ["mobility", "fundamentals"],
          certifications: ["NASM CPT"],
          hireDate: new Date("2024-01-10T00:00:00.000Z"),
        },
      },
    },
  });
}

async function seedClient() {
  const passwordHash = await hash("Client123!", 12);

  return prisma.user.upsert({
    where: { email: "client@onthematstudio.local" },
    update: {
      name: "Client User",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-10T18:45:00.000Z"),
      clientProfile: {
        upsert: {
          update: {
            phone: "+32000000002",
            dateOfBirth: new Date("1994-08-22T00:00:00.000Z"),
            emergencyContactName: "Client Emergency Contact",
            emergencyContactPhone: "+32000000098",
            notes: "Prefers evening classes and low-impact warmups.",
          },
          create: {
            phone: "+32000000002",
            dateOfBirth: new Date("1994-08-22T00:00:00.000Z"),
            emergencyContactName: "Client Emergency Contact",
            emergencyContactPhone: "+32000000098",
            notes: "Prefers evening classes and low-impact warmups.",
          },
        },
      },
    },
    create: {
      email: "client@onthematstudio.local",
      name: "Client User",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-10T18:45:00.000Z"),
      clientProfile: {
        create: {
          phone: "+32000000002",
          dateOfBirth: new Date("1994-08-22T00:00:00.000Z"),
          emergencyContactName: "Client Emergency Contact",
          emergencyContactPhone: "+32000000098",
          notes: "Prefers evening classes and low-impact warmups.",
        },
      },
    },
  });
}

async function seedClientTwo() {
  const passwordHash = await hash("ClientTwo123!", 12);

  return prisma.user.upsert({
    where: { email: "client.two@onthematstudio.local" },
    update: {
      name: "Client Two",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-12T16:20:00.000Z"),
      clientProfile: {
        upsert: {
          update: {
            phone: "+32000000004",
            dateOfBirth: new Date("1991-02-11T00:00:00.000Z"),
            emergencyContactName: "Client Two Emergency Contact",
            emergencyContactPhone: "+32000000096",
            notes: "Prefers morning classes.",
          },
          create: {
            phone: "+32000000004",
            dateOfBirth: new Date("1991-02-11T00:00:00.000Z"),
            emergencyContactName: "Client Two Emergency Contact",
            emergencyContactPhone: "+32000000096",
            notes: "Prefers morning classes.",
          },
        },
      },
    },
    create: {
      email: "client.two@onthematstudio.local",
      name: "Client Two",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-12T16:20:00.000Z"),
      clientProfile: {
        create: {
          phone: "+32000000004",
          dateOfBirth: new Date("1991-02-11T00:00:00.000Z"),
          emergencyContactName: "Client Two Emergency Contact",
          emergencyContactPhone: "+32000000096",
          notes: "Prefers morning classes.",
        },
      },
    },
  });
}

async function seedClientThree() {
  const passwordHash = await hash("ClientThree123!", 12);

  return prisma.user.upsert({
    where: { email: "client.three@onthematstudio.local" },
    update: {
      name: "Client Three",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-08T14:10:00.000Z"),
      clientProfile: {
        upsert: {
          update: {
            phone: "+32000000005",
            dateOfBirth: new Date("1996-10-03T00:00:00.000Z"),
            emergencyContactName: "Client Three Emergency Contact",
            emergencyContactPhone: "+32000000095",
            notes: "Waiting list often used for evening sessions.",
          },
          create: {
            phone: "+32000000005",
            dateOfBirth: new Date("1996-10-03T00:00:00.000Z"),
            emergencyContactName: "Client Three Emergency Contact",
            emergencyContactPhone: "+32000000095",
            notes: "Waiting list often used for evening sessions.",
          },
        },
      },
    },
    create: {
      email: "client.three@onthematstudio.local",
      name: "Client Three",
      role: Role.CLIENT,
      passwordHash,
      isActive: true,
      isInactive: false,
      lastLoginAt: new Date("2026-03-08T14:10:00.000Z"),
      clientProfile: {
        create: {
          phone: "+32000000005",
          dateOfBirth: new Date("1996-10-03T00:00:00.000Z"),
          emergencyContactName: "Client Three Emergency Contact",
          emergencyContactPhone: "+32000000095",
          notes: "Waiting list often used for evening sessions.",
        },
      },
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
  giftValueMinor?: number;
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
      giftValueMinor: input.giftValueMinor,
      notes: input.notes,
      isActive: true,
    },
    create: {
      productId: input.productId,
      entitlementType: input.entitlementType,
      entitlementScope: input.entitlementScope,
      quantity: input.quantity,
      validForDays: input.validForDays,
      giftValueMinor: input.giftValueMinor,
      notes: input.notes,
      isActive: true,
    },
  });
}

async function seedCatalog() {
  const collectiveDropIn = await upsertProduct({
    slug: "collective-drop-in",
    name: "Collective Class Drop-In",
    description: "Single booking access for yoga, pilates, and functional collective classes.",
    productType: ProductType.DROP_IN_CLASS,
    sortOrder: 10,
  });
  await upsertPrice({
    productId: collectiveDropIn.id,
    lookupKey: "collective-drop-in-eur-once-v1",
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

  const tenClassPack = await upsertProduct({
    slug: "collective-10-class-pack",
    name: "10-Class Collective Pack",
    description: "Ten class credits usable for all collective yoga, pilates, and functional sessions.",
    productType: ProductType.CLASS_PACK,
    sortOrder: 20,
  });
  await upsertPrice({
    productId: tenClassPack.id,
    lookupKey: "collective-10-pack-eur-once-v1",
    name: "10-Class Pack - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 18900,
  });
  await upsertEntitlementRule({
    productId: tenClassPack.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    quantity: 10,
    validForDays: 120,
    notes: "Ten credits valid for collective classes.",
  });

  const monthlyUnlimitedCollective = await upsertProduct({
    slug: "monthly-unlimited-collective",
    name: "Monthly Unlimited Collective",
    description: "Unlimited collective classes with monthly billing.",
    productType: ProductType.UNLIMITED_MEMBERSHIP,
    sortOrder: 30,
  });
  await upsertPrice({
    productId: monthlyUnlimitedCollective.id,
    lookupKey: "monthly-unlimited-collective-eur-monthly-v1",
    name: "Monthly Unlimited Collective - Monthly",
    priceType: PriceType.RECURRING,
    currencyCode: "EUR",
    unitAmountMinor: 12900,
    billingInterval: BillingInterval.MONTH,
    billingIntervalCount: 1,
  });
  await upsertEntitlementRule({
    productId: monthlyUnlimitedCollective.id,
    entitlementType: EntitlementType.UNLIMITED_ACCESS,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    validForDays: 30,
    notes: "Unlimited collective access for active monthly period.",
  });

  const introPass = await upsertProduct({
    slug: "intro-pass-3-classes",
    name: "Intro Pass - 3 Classes",
    description: "New client starter pass with short validity window.",
    productType: ProductType.INTRO_OFFER,
    sortOrder: 40,
  });
  await upsertPrice({
    productId: introPass.id,
    lookupKey: "intro-pass-3-classes-eur-once-v1",
    name: "Intro Pass - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 4900,
  });
  await upsertEntitlementRule({
    productId: introPass.id,
    entitlementType: EntitlementType.CREDIT_PACK,
    entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
    quantity: 3,
    validForDays: 21,
    notes: "Introductory pass for first-time clients.",
  });

  const privateReformerSingle = await upsertProduct({
    slug: "private-reformer-single",
    name: "Private Reformer - Single Session",
    description: "One-on-one private reformer coaching session.",
    productType: ProductType.PRIVATE_CLASS,
    sortOrder: 50,
  });
  await upsertPrice({
    productId: privateReformerSingle.id,
    lookupKey: "private-reformer-single-eur-once-v1",
    name: "Private Reformer - One Time",
    priceType: PriceType.ONE_TIME,
    currencyCode: "EUR",
    unitAmountMinor: 6800,
  });
  await upsertEntitlementRule({
    productId: privateReformerSingle.id,
    entitlementType: EntitlementType.SINGLE_USE,
    entitlementScope: EntitlementScope.PRIVATE_CLASSES,
    quantity: 1,
    validForDays: 60,
    notes: "Single-use private class entitlement.",
  });
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
  isVisible?: boolean;
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
      isVisible: input.isVisible ?? true,
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
      isVisible: input.isVisible ?? true,
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
  status: StudioSessionStatus;
  cancelledAt?: Date;
  cancelledReason?: string;
  cancelledById?: string;
  isPublished: boolean;
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
      status: input.status,
      cancelledAt: input.cancelledAt,
      cancelledReason: input.cancelledReason,
      cancelledById: input.cancelledById,
      isPublished: input.isPublished,
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
      status: input.status,
      cancelledAt: input.cancelledAt,
      cancelledReason: input.cancelledReason,
      cancelledById: input.cancelledById,
      isPublished: input.isPublished,
    },
  });
}

async function seedScheduling(params: {
  masterAdminId: string;
  primaryTeacherId: string;
  assistantTeacherId: string;
}) {
  await prisma.attendanceRecord.deleteMany();
  await prisma.waitlistEntry.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.studioSession.deleteMany();
  await prisma.recurringRule.deleteMany();
  await prisma.classTemplate.deleteMany();
  await prisma.classType.deleteMany();
  await prisma.classCategory.deleteMany();

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
  const privateReformerCategory = await upsertClassCategory({
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
    categoryId: privateReformerCategory.id,
    name: "Private Reformer Coaching",
    description: "Private 1:1 or duo coaching on the reformer.",
    imageUrl: "/images/classes/private-reformer-coaching.jpg",
    defaultDurationMinutes: 50,
    defaultCapacity: 2,
    pricingMode: ServicePricingMode.SINGLE_ONLY,
    sortOrder: 10,
  });

  const vinyasaTemplate = await upsertClassTemplate({
    slug: "vinyasa-flow-brussels",
    classTypeId: vinyasaYoga.id,
    defaultTeacherId: params.primaryTeacherId,
    title: "Vinyasa Flow Brussels",
    description:
      "A full-spectrum vinyasa class combining warm-up, standing sequences, and mindful cooldown.",
    location: "Ixelles Studio A",
    defaultCapacity: vinyasaYoga.defaultCapacity,
    defaultDurationMinutes: vinyasaYoga.defaultDurationMinutes,
  });
  const rocketTemplate = await upsertClassTemplate({
    slug: "rocket-yoga-power-sequence",
    classTypeId: rocketYoga.id,
    defaultTeacherId: params.primaryTeacherId,
    title: "Rocket Yoga Power Sequence",
    description:
      "Progressive rocket yoga with options for inversion prep and core stability.",
    location: "Ixelles Studio B",
    defaultCapacity: rocketYoga.defaultCapacity,
    defaultDurationMinutes: rocketYoga.defaultDurationMinutes,
  });
  const hathaTemplate = await upsertClassTemplate({
    slug: "hatha-reset-weekend",
    classTypeId: hathaYoga.id,
    defaultTeacherId: params.assistantTeacherId,
    title: "Hatha Reset Weekend",
    description:
      "A grounding hatha class focused on posture quality, breath rhythm, and recovery.",
    location: "Ixelles Studio A",
    defaultCapacity: hathaYoga.defaultCapacity,
    defaultDurationMinutes: hathaYoga.defaultDurationMinutes,
  });
  const matPilatesTemplate = await upsertClassTemplate({
    slug: "mat-pilates-core-lab",
    classTypeId: matPilates.id,
    defaultTeacherId: params.assistantTeacherId,
    title: "Mat Pilates Core Lab",
    description:
      "Core and glute-focused mat pilates with structured progressions and prop work.",
    location: "Etterbeek Studio C",
    defaultCapacity: matPilates.defaultCapacity,
    defaultDurationMinutes: matPilates.defaultDurationMinutes,
  });
  const reformerTemplate = await upsertClassTemplate({
    slug: "reformer-foundations-small-group",
    classTypeId: reformerFoundations.id,
    defaultTeacherId: params.primaryTeacherId,
    title: "Reformer Foundations Small Group",
    description:
      "Technique-first reformer foundations for beginners and returning clients.",
    location: "Ixelles Reformer Room",
    defaultCapacity: reformerFoundations.defaultCapacity,
    defaultDurationMinutes: reformerFoundations.defaultDurationMinutes,
  });
  const functionalTemplate = await upsertClassTemplate({
    slug: "functional-strength-express",
    classTypeId: functionalStrength.id,
    defaultTeacherId: params.assistantTeacherId,
    title: "Functional Strength Express",
    description:
      "High-focus functional strength class with mobility warm-up and interval blocks.",
    location: "Etterbeek Performance Room",
    defaultCapacity: functionalStrength.defaultCapacity,
    defaultDurationMinutes: functionalStrength.defaultDurationMinutes,
  });
  const privateReformerTemplate = await upsertClassTemplate({
    slug: "private-reformer-coaching-slot",
    classTypeId: privateReformerCoaching.id,
    defaultTeacherId: params.primaryTeacherId,
    title: "Private Reformer Coaching",
    description:
      "Private coaching slot tailored to injuries, goals, and postural priorities.",
    location: "Ixelles Private Studio",
    defaultCapacity: privateReformerCoaching.defaultCapacity,
    defaultDurationMinutes: privateReformerCoaching.defaultDurationMinutes,
  });

  const recurringDefinitions = [
    {
      template: vinyasaTemplate,
      classType: vinyasaYoga,
      weekday: Weekday.MONDAY,
      startTime: "07:00",
      teacherId: params.primaryTeacherId,
      cancellationIndex: 1,
    },
    {
      template: vinyasaTemplate,
      classType: vinyasaYoga,
      weekday: Weekday.WEDNESDAY,
      startTime: "18:30",
      teacherId: params.primaryTeacherId,
    },
    {
      template: rocketTemplate,
      classType: rocketYoga,
      weekday: Weekday.SATURDAY,
      startTime: "09:00",
      teacherId: params.primaryTeacherId,
    },
    {
      template: hathaTemplate,
      classType: hathaYoga,
      weekday: Weekday.SUNDAY,
      startTime: "10:30",
      teacherId: params.assistantTeacherId,
    },
    {
      template: matPilatesTemplate,
      classType: matPilates,
      weekday: Weekday.TUESDAY,
      startTime: "12:15",
      teacherId: params.assistantTeacherId,
    },
    {
      template: matPilatesTemplate,
      classType: matPilates,
      weekday: Weekday.THURSDAY,
      startTime: "19:00",
      teacherId: params.assistantTeacherId,
    },
    {
      template: reformerTemplate,
      classType: reformerFoundations,
      weekday: Weekday.FRIDAY,
      startTime: "17:30",
      teacherId: params.primaryTeacherId,
    },
    {
      template: functionalTemplate,
      classType: functionalStrength,
      weekday: Weekday.TUESDAY,
      startTime: "07:00",
      teacherId: params.assistantTeacherId,
    },
    {
      template: functionalTemplate,
      classType: functionalStrength,
      weekday: Weekday.THURSDAY,
      startTime: "07:00",
      teacherId: params.assistantTeacherId,
    },
    {
      template: privateReformerTemplate,
      classType: privateReformerCoaching,
      weekday: Weekday.WEDNESDAY,
      startTime: "12:00",
      teacherId: params.primaryTeacherId,
    },
    {
      template: privateReformerTemplate,
      classType: privateReformerCoaching,
      weekday: Weekday.SATURDAY,
      startTime: "11:30",
      teacherId: params.primaryTeacherId,
    },
  ] as const;

  for (const definition of recurringDefinitions) {
    const recurringRule = await upsertRecurringRule({
      classTemplateId: definition.template.id,
      weekday: definition.weekday,
      startTime: definition.startTime,
      startDate: SCHEDULE_WINDOW_START,
      endDate: SCHEDULE_WINDOW_END,
    });

    const startsAtList = nextOccurrencesInWindow({
      weekday: definition.weekday,
      time: definition.startTime,
      windowStart: SCHEDULE_WINDOW_START,
      windowEnd: SCHEDULE_WINDOW_END,
    });

    for (let index = 0; index < startsAtList.length; index += 1) {
      const startsAt = startsAtList[index];
      const endsAt = new Date(
        startsAt.getTime() + definition.template.defaultDurationMinutes * 60 * 1000,
      );
      const isCancelled = definition.cancellationIndex === index;

      await upsertStudioSession({
        classTemplateId: definition.template.id,
        recurringRuleId: recurringRule.id,
        classTypeId: definition.classType.id,
        teacherId: definition.teacherId,
        title: definition.template.title,
        description: definition.template.description ?? undefined,
        location: definition.template.location ?? undefined,
        startsAt,
        endsAt,
        capacity: definition.template.defaultCapacity,
        status: isCancelled ? StudioSessionStatus.CANCELLED : StudioSessionStatus.SCHEDULED,
        cancelledAt: isCancelled ? new Date(startsAt.getTime() - 4 * 60 * 60 * 1000) : undefined,
        cancelledReason: isCancelled
          ? "Planned replacement due to teacher availability."
          : undefined,
        cancelledById: isCancelled ? params.masterAdminId : undefined,
        isPublished: true,
      });
    }
  }

  const oneOffStartsAt = new Date("2026-04-26T14:00:00.000Z");
  const oneOffEndsAt = new Date(
    oneOffStartsAt.getTime() + functionalTemplate.defaultDurationMinutes * 60 * 1000,
  );

  await upsertStudioSession({
    classTemplateId: functionalTemplate.id,
    classTypeId: functionalStrength.id,
    teacherId: params.assistantTeacherId,
    title: "Functional Strength Pop-Up",
    description: "Special Sunday conditioning pop-up session.",
    location: functionalTemplate.location ?? undefined,
    startsAt: oneOffStartsAt,
    endsAt: oneOffEndsAt,
    capacity: 12,
    status: StudioSessionStatus.SCHEDULED,
    isPublished: true,
  });
}

async function upsertBooking(input: {
  clientId: string;
  studioSessionId: string;
  status: BookingStatus;
  bookedAt: Date;
  orderId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerMessage?: string;
  cancelledAt?: Date;
  cancellationReason?: string;
  cancelledById?: string;
}) {
  return prisma.booking.upsert({
    where: {
      clientId_studioSessionId: {
        clientId: input.clientId,
        studioSessionId: input.studioSessionId,
      },
    },
    update: {
      status: input.status,
      bookedAt: input.bookedAt,
      orderId: input.orderId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      customerMessage: input.customerMessage,
      cancelledAt: input.cancelledAt,
      cancellationReason: input.cancellationReason,
      cancelledById: input.cancelledById,
    },
    create: {
      clientId: input.clientId,
      studioSessionId: input.studioSessionId,
      status: input.status,
      bookedAt: input.bookedAt,
      orderId: input.orderId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      customerMessage: input.customerMessage,
      cancelledAt: input.cancelledAt,
      cancellationReason: input.cancellationReason,
      cancelledById: input.cancelledById,
    },
  });
}

async function upsertWaitlistEntry(input: {
  clientId: string;
  studioSessionId: string;
  status: WaitlistStatus;
  position: number;
  joinedAt: Date;
  promotedAt?: Date;
}) {
  return prisma.waitlistEntry.upsert({
    where: {
      clientId_studioSessionId: {
        clientId: input.clientId,
        studioSessionId: input.studioSessionId,
      },
    },
    update: {
      status: input.status,
      position: input.position,
      joinedAt: input.joinedAt,
      promotedAt: input.promotedAt,
    },
    create: {
      clientId: input.clientId,
      studioSessionId: input.studioSessionId,
      status: input.status,
      position: input.position,
      joinedAt: input.joinedAt,
      promotedAt: input.promotedAt,
    },
  });
}

async function upsertAttendanceRecord(input: {
  bookingId: string;
  status: AttendanceStatus;
  markedAt: Date;
  markedById: string;
  notes?: string;
}) {
  return prisma.attendanceRecord.upsert({
    where: { bookingId: input.bookingId },
    update: {
      status: input.status,
      markedAt: input.markedAt,
      markedById: input.markedById,
      notes: input.notes,
    },
    create: {
      bookingId: input.bookingId,
      status: input.status,
      markedAt: input.markedAt,
      markedById: input.markedById,
      notes: input.notes,
    },
  });
}

async function seedBookingOperations(params: {
  masterAdminId: string;
  primaryTeacherId: string;
  clientOneId: string;
  clientTwoId: string;
  clientThreeId: string;
}) {
  const scheduledSessions = await prisma.studioSession.findMany({
    where: { status: StudioSessionStatus.SCHEDULED },
    orderBy: { startsAt: "asc" },
    take: 5,
  });

  if (scheduledSessions.length < 4) {
    throw new Error("Insufficient scheduled sessions for booking seed data.");
  }

  const bookingOne = await upsertBooking({
    clientId: params.clientOneId,
    studioSessionId: scheduledSessions[0].id,
    status: BookingStatus.CONFIRMED,
    bookedAt: new Date("2026-03-20T09:00:00.000Z"),
    customerName: "Client One",
    customerEmail: "client1@onthematstudio.local",
    customerPhone: "+32000000001",
  });

  await upsertBooking({
    clientId: params.clientOneId,
    studioSessionId: scheduledSessions[1].id,
    status: BookingStatus.PENDING,
    bookedAt: new Date("2026-03-20T09:05:00.000Z"),
    customerName: "Client One",
    customerEmail: "client1@onthematstudio.local",
    customerPhone: "+32000000001",
  });

  await upsertBooking({
    clientId: params.clientOneId,
    studioSessionId: scheduledSessions[1].id,
    status: BookingStatus.CANCELLED,
    bookedAt: new Date("2026-03-20T09:05:00.000Z"),
    customerName: "Client One",
    customerEmail: "client1@onthematstudio.local",
    customerPhone: "+32000000001",
    cancelledAt: new Date("2026-03-21T08:00:00.000Z"),
    cancellationReason: "Client cancelled before cutoff.",
    cancelledById: params.masterAdminId,
  });

  await upsertBooking({
    clientId: params.clientTwoId,
    studioSessionId: scheduledSessions[2].id,
    status: BookingStatus.CONFIRMED,
    bookedAt: new Date("2026-03-20T09:10:00.000Z"),
    customerName: "Client Two",
    customerEmail: "client2@onthematstudio.local",
    customerPhone: "+32000000002",
  });

  await upsertBooking({
    clientId: params.clientThreeId,
    studioSessionId: scheduledSessions[3].id,
    status: BookingStatus.CONFIRMED,
    bookedAt: new Date("2026-03-20T09:15:00.000Z"),
    customerName: "Client Three",
    customerEmail: "client3@onthematstudio.local",
    customerPhone: "+32000000003",
  });

  const privateSession = await prisma.studioSession.findFirst({
    where: {
      status: StudioSessionStatus.SCHEDULED,
      classType: { slug: "private-reformer-coaching" },
    },
    orderBy: { startsAt: "asc" },
  });

  if (privateSession) {
    await upsertBooking({
      clientId: params.clientTwoId,
      studioSessionId: privateSession.id,
      status: BookingStatus.CONFIRMED,
      bookedAt: new Date("2026-03-20T09:35:00.000Z"),
      customerName: "Client Two",
      customerEmail: "client2@onthematstudio.local",
      customerPhone: "+32000000002",
    });

    await upsertBooking({
      clientId: params.clientThreeId,
      studioSessionId: privateSession.id,
      status: BookingStatus.CONFIRMED,
      bookedAt: new Date("2026-03-20T09:40:00.000Z"),
      customerName: "Client Three",
      customerEmail: "client3@onthematstudio.local",
      customerPhone: "+32000000003",
    });

    await upsertWaitlistEntry({
      clientId: params.clientOneId,
      studioSessionId: privateSession.id,
      status: WaitlistStatus.ACTIVE,
      position: 1,
      joinedAt: new Date("2026-03-20T09:45:00.000Z"),
    });
  }

  const existingGuestBooking = await prisma.booking.findFirst({
    where: {
      clientId: null,
      studioSessionId: scheduledSessions[0].id,
      customerEmail: "guest.walkin@example.com",
    },
  });

  if (existingGuestBooking) {
    await prisma.booking.update({
      where: { id: existingGuestBooking.id },
      data: {
        status: BookingStatus.PENDING,
        bookedAt: new Date("2026-03-20T09:25:00.000Z"),
        customerName: "Guest Walk-in",
        customerEmail: "guest.walkin@example.com",
        customerPhone: "+32000000999",
        customerMessage: "First class, beginner level preference.",
      },
    });
  } else {
    await prisma.booking.create({
      data: {
        studioSessionId: scheduledSessions[0].id,
        status: BookingStatus.PENDING,
        bookedAt: new Date("2026-03-20T09:25:00.000Z"),
        customerName: "Guest Walk-in",
        customerEmail: "guest.walkin@example.com",
        customerPhone: "+32000000999",
        customerMessage: "First class, beginner level preference.",
      },
    });
  }

  await upsertWaitlistEntry({
    clientId: params.clientThreeId,
    studioSessionId: scheduledSessions[0].id,
    status: WaitlistStatus.ACTIVE,
    position: 1,
    joinedAt: new Date("2026-03-20T09:20:00.000Z"),
  });

  await upsertAttendanceRecord({
    bookingId: bookingOne.id,
    status: AttendanceStatus.ATTENDED,
    markedAt: new Date("2026-03-22T08:30:00.000Z"),
    markedById: params.primaryTeacherId,
    notes: "Present and completed full class.",
  });
}

async function seedCommerce(params: {
  masterAdminId: string;
  clientOneId: string;
  clientTwoId: string;
  clientThreeId: string;
}) {
  const prices = await prisma.price.findMany({
    where: {
      lookupKey: {
        in: [
          "collective-drop-in-eur-once-v1",
          "collective-10-pack-eur-once-v1",
          "monthly-unlimited-collective-eur-monthly-v1",
        ],
      },
    },
    include: {
      product: true,
    },
  });

  const priceByKey = new Map(prices.map((price) => [price.lookupKey, price]));
  const dropInPrice = priceByKey.get("collective-drop-in-eur-once-v1");
  const classPackPrice = priceByKey.get("collective-10-pack-eur-once-v1");
  const membershipPrice = priceByKey.get("monthly-unlimited-collective-eur-monthly-v1");

  if (!dropInPrice || !classPackPrice || !membershipPrice) {
    throw new Error("Required catalog prices are missing for commerce seed.");
  }

  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.creditLedgerEntry.deleteMany();
  await prisma.clientEntitlement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionContract.deleteMany();

  const orderOne = await prisma.order.create({
    data: {
      clientId: params.clientOneId,
      subtotalAmountMinor: dropInPrice.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: dropInPrice.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.PAID,
      placedAt: new Date("2026-03-15T10:00:00.000Z"),
      notes: "Single drop-in purchase.",
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: orderOne.id,
      productId: dropInPrice.productId,
      priceId: dropInPrice.id,
      quantity: 1,
      productNameSnapshot: dropInPrice.product.name,
      priceNameSnapshot: dropInPrice.name,
      unitAmountMinor: dropInPrice.unitAmountMinor,
      lineSubtotalAmountMinor: dropInPrice.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: dropInPrice.unitAmountMinor,
      currencyCode: "EUR",
    },
  });
  await prisma.payment.create({
    data: {
      orderId: orderOne.id,
      status: PaymentStatus.SUCCEEDED,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: "pi_3A0000000001",
      amountMinor: orderOne.totalAmountMinor,
      currencyCode: "EUR",
      authorizedAt: new Date("2026-03-15T10:01:00.000Z"),
      capturedAt: new Date("2026-03-15T10:01:10.000Z"),
    },
  });

  const orderTwo = await prisma.order.create({
    data: {
      clientId: params.clientTwoId,
      subtotalAmountMinor: classPackPrice.unitAmountMinor,
      discountAmountMinor: 1000,
      totalAmountMinor: classPackPrice.unitAmountMinor - 1000,
      currencyCode: "EUR",
      status: OrderStatus.PLACED,
      placedAt: new Date("2026-03-18T12:20:00.000Z"),
      notes: "Class pack with promotional discount.",
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: orderTwo.id,
      productId: classPackPrice.productId,
      priceId: classPackPrice.id,
      quantity: 1,
      productNameSnapshot: classPackPrice.product.name,
      priceNameSnapshot: classPackPrice.name,
      unitAmountMinor: classPackPrice.unitAmountMinor,
      lineSubtotalAmountMinor: classPackPrice.unitAmountMinor,
      lineDiscountAmountMinor: 1000,
      lineTotalAmountMinor: classPackPrice.unitAmountMinor - 1000,
      currencyCode: "EUR",
    },
  });
  await prisma.payment.create({
    data: {
      orderId: orderTwo.id,
      status: PaymentStatus.PENDING,
      method: PaymentMethod.BANK_TRANSFER,
      provider: PaymentProvider.MOLLIE,
      providerReference: "tr_pending_0002",
      amountMinor: orderTwo.totalAmountMinor,
      currencyCode: "EUR",
      authorizedAt: new Date("2026-03-18T12:21:00.000Z"),
    },
  });

  const orderThree = await prisma.order.create({
    data: {
      clientId: params.clientThreeId,
      subtotalAmountMinor: membershipPrice.unitAmountMinor,
      discountAmountMinor: 0,
      totalAmountMinor: membershipPrice.unitAmountMinor,
      currencyCode: "EUR",
      status: OrderStatus.CANCELLED,
      placedAt: new Date("2026-03-19T08:45:00.000Z"),
      notes: "Membership checkout failed.",
    },
  });
  await prisma.orderItem.create({
    data: {
      orderId: orderThree.id,
      productId: membershipPrice.productId,
      priceId: membershipPrice.id,
      quantity: 1,
      productNameSnapshot: membershipPrice.product.name,
      priceNameSnapshot: membershipPrice.name,
      unitAmountMinor: membershipPrice.unitAmountMinor,
      lineSubtotalAmountMinor: membershipPrice.unitAmountMinor,
      lineDiscountAmountMinor: 0,
      lineTotalAmountMinor: membershipPrice.unitAmountMinor,
      currencyCode: "EUR",
    },
  });
  await prisma.payment.create({
    data: {
      orderId: orderThree.id,
      status: PaymentStatus.FAILED,
      method: PaymentMethod.CARD,
      provider: PaymentProvider.STRIPE,
      providerReference: "pi_3A0000000003",
      amountMinor: orderThree.totalAmountMinor,
      currencyCode: "EUR",
      authorizedAt: new Date("2026-03-19T08:46:00.000Z"),
      failedAt: new Date("2026-03-19T08:46:30.000Z"),
      failureReason: "Card declined by issuer.",
    },
  });

  const activeSubscription = await prisma.subscriptionContract.create({
    data: {
      clientId: params.clientThreeId,
      productId: membershipPrice.productId,
      priceId: membershipPrice.id,
      status: SubscriptionStatus.ACTIVE,
      startsAt: new Date("2026-03-01T00:00:00.000Z"),
      currentPeriodStart: new Date("2026-03-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-03-31T23:59:59.000Z"),
      cancelAtPeriodEnd: false,
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference: "sub_active_0001",
    },
  });

  await prisma.subscriptionContract.create({
    data: {
      clientId: params.clientOneId,
      productId: membershipPrice.productId,
      priceId: membershipPrice.id,
      status: SubscriptionStatus.CANCELLED,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodStart: new Date("2026-02-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-02-28T23:59:59.000Z"),
      cancelAtPeriodEnd: true,
      cancelledAt: new Date("2026-02-15T10:30:00.000Z"),
      endedAt: new Date("2026-02-28T23:59:59.000Z"),
      provider: PaymentProvider.STRIPE,
      providerSubscriptionReference: "sub_cancelled_0002",
    },
  });

  const clientOneConfirmedBooking = await prisma.booking.findFirst({
    where: {
      clientId: params.clientOneId,
      status: BookingStatus.CONFIRMED,
    },
    orderBy: { bookedAt: "asc" },
  });

  const clientTwoConfirmedBooking = await prisma.booking.findFirst({
    where: {
      clientId: params.clientTwoId,
      status: BookingStatus.CONFIRMED,
    },
    orderBy: { bookedAt: "asc" },
  });

  const dropInEntitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: params.clientOneId,
      productId: dropInPrice.productId,
      orderId: orderOne.id,
      entitlementType: EntitlementType.SINGLE_USE,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date("2026-03-15T10:02:00.000Z"),
      expiresAt: new Date("2026-04-15T10:02:00.000Z"),
      notes: "Granted from paid drop-in order.",
    },
  });

  const classPackEntitlement = await prisma.clientEntitlement.create({
    data: {
      clientId: params.clientTwoId,
      productId: classPackPrice.productId,
      orderId: orderTwo.id,
      entitlementType: EntitlementType.CREDIT_PACK,
      entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date("2026-03-18T12:30:00.000Z"),
      expiresAt: new Date("2026-06-18T12:30:00.000Z"),
      notes: "10-class pack entitlement.",
    },
  });

  await prisma.clientEntitlement.create({
    data: {
      clientId: params.clientThreeId,
      productId: membershipPrice.productId,
      subscriptionContractId: activeSubscription.id,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: EntitlementScope.ALL_CLASSES,
      status: ClientEntitlementStatus.ACTIVE,
      activatedAt: new Date("2026-03-01T00:00:00.000Z"),
      expiresAt: new Date("2026-03-31T23:59:59.000Z"),
      notes: "Active unlimited entitlement from subscription.",
    },
  });

  await prisma.creditLedgerEntry.create({
    data: {
      clientId: params.clientOneId,
      entitlementId: dropInEntitlement.id,
      orderId: orderOne.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 1,
      happenedAt: new Date("2026-03-15T10:02:00.000Z"),
      createdById: params.masterAdminId,
      notes: "Drop-in credit granted after successful payment.",
    },
  });

  if (clientOneConfirmedBooking) {
    await prisma.creditLedgerEntry.create({
      data: {
        clientId: params.clientOneId,
        entitlementId: dropInEntitlement.id,
        bookingId: clientOneConfirmedBooking.id,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        happenedAt: new Date("2026-03-20T09:30:00.000Z"),
        createdById: params.masterAdminId,
        notes: "Drop-in credit consumed for booked session.",
      },
    });
  }

  await prisma.creditLedgerEntry.create({
    data: {
      clientId: params.clientTwoId,
      entitlementId: classPackEntitlement.id,
      orderId: orderTwo.id,
      entryType: CreditLedgerEntryType.GRANT,
      amount: 10,
      happenedAt: new Date("2026-03-18T12:30:00.000Z"),
      createdById: params.masterAdminId,
      notes: "Class pack credits granted.",
    },
  });

  if (clientTwoConfirmedBooking) {
    await prisma.creditLedgerEntry.create({
      data: {
        clientId: params.clientTwoId,
        entitlementId: classPackEntitlement.id,
        bookingId: clientTwoConfirmedBooking.id,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        happenedAt: new Date("2026-03-21T07:45:00.000Z"),
        createdById: params.masterAdminId,
        notes: "One class-pack credit consumed on booking.",
      },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: params.clientTwoId,
        entitlementId: classPackEntitlement.id,
        bookingId: clientTwoConfirmedBooking.id,
        entryType: CreditLedgerEntryType.RESTORE,
        amount: 1,
        happenedAt: new Date("2026-03-21T12:15:00.000Z"),
        createdById: params.masterAdminId,
        notes: "Credit restored after manual cancellation review.",
      },
    });
  }

  await prisma.loyaltyLedgerEntry.createMany({
    data: [
      {
        clientId: params.clientOneId,
        orderId: orderOne.id,
        entryType: LoyaltyLedgerEntryType.EARN,
        amount: 15,
        happenedAt: new Date("2026-03-15T10:05:00.000Z"),
        createdById: params.masterAdminId,
        notes: "Loyalty points earned on purchase.",
      },
      {
        clientId: params.clientOneId,
        entryType: LoyaltyLedgerEntryType.REDEEM,
        amount: -10,
        happenedAt: new Date("2026-03-16T11:00:00.000Z"),
        createdById: params.masterAdminId,
        notes: "Loyalty points redeemed for in-studio reward.",
      },
      {
        clientId: params.clientTwoId,
        orderId: orderTwo.id,
        entryType: LoyaltyLedgerEntryType.EARN,
        amount: 40,
        happenedAt: new Date("2026-03-18T12:35:00.000Z"),
        createdById: params.masterAdminId,
        notes: "Loyalty points provisionally earned.",
      },
    ],
  });
}

async function seedAdminSupport(params: {
  masterAdminId: string;
  primaryTeacherId: string;
  clientOneId: string;
  clientTwoId: string;
}) {
  await prisma.adminNote.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.contactMessage.deleteMany();

  const paidOrderClientOne = await prisma.order.findFirst({
    where: {
      clientId: params.clientOneId,
      status: OrderStatus.PAID,
    },
    orderBy: { placedAt: "desc" },
  });

  const placedOrderClientTwo = await prisma.order.findFirst({
    where: {
      clientId: params.clientTwoId,
      status: OrderStatus.PLACED,
    },
    orderBy: { placedAt: "desc" },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        actorId: params.masterAdminId,
        actionType: "ORDER_STATUS_UPDATED",
        entityType: "Order",
        entityId: placedOrderClientTwo?.id,
        metadata: { from: "PLACED", to: "PLACED", reason: "Manual review noted." },
      },
      {
        actorId: params.primaryTeacherId,
        actionType: "ATTENDANCE_MARKED",
        entityType: "AttendanceRecord",
        metadata: { source: "seed", notes: "Attendance marked by teacher." },
      },
      {
        actionType: "LEDGER_RECONCILIATION_RUN",
        entityType: "SystemJob",
        entityId: "nightly-reconciliation",
        metadata: { runDate: "2026-03-20", result: "ok" },
      },
    ],
  });

  await prisma.adminNote.create({
    data: {
      authorId: params.masterAdminId,
      clientId: params.clientOneId,
      orderId: paidOrderClientOne?.id,
      body: "Client requested invoice resend by email; fulfilled by support.",
      createdAt: new Date("2026-03-20T10:05:00.000Z"),
    },
  });

  await prisma.adminNote.create({
    data: {
      authorId: params.masterAdminId,
      clientId: params.clientTwoId,
      orderId: placedOrderClientTwo?.id,
      body: "Pending transfer flagged for follow-up if payment remains unsettled after 48h.",
      createdAt: new Date("2026-03-20T10:20:00.000Z"),
    },
  });

  await prisma.contactMessage.create({
    data: {
      clientId: params.clientOneId,
      name: "Client One",
      email: "client1@onthematstudio.local",
      subject: "Need help with class credits",
      message: "I cancelled a booking and want to confirm my credit was restored.",
      status: ContactMessageStatus.RESOLVED,
      resolvedAt: new Date("2026-03-20T11:00:00.000Z"),
      resolvedById: params.masterAdminId,
      createdAt: new Date("2026-03-20T09:40:00.000Z"),
    },
  });

  await prisma.contactMessage.create({
    data: {
      name: "Taylor Prospect",
      email: "taylor.prospect@example.com",
      subject: "Trial class availability",
      message: "Do you have any beginner classes this weekend?",
      status: ContactMessageStatus.OPEN,
      createdAt: new Date("2026-03-20T10:10:00.000Z"),
    },
  });
}

async function verifySeedCoverage() {
  const [categoryCount, classTypeCount, futureSessionCount, purchasableOptionCount] =
    await prisma.$transaction([
      prisma.classCategory.count(),
      prisma.classType.count(),
      prisma.studioSession.count({
        where: {
          startsAt: { gte: SCHEDULE_WINDOW_START },
          status: StudioSessionStatus.SCHEDULED,
        },
      }),
      prisma.product.count({
        where: {
          isActive: true,
          prices: {
            some: {},
          },
        },
      }),
    ]);

  if (categoryCount < 4) {
    throw new Error(`Seed verification failed: expected at least 4 categories, got ${categoryCount}.`);
  }

  if (classTypeCount < 6) {
    throw new Error(`Seed verification failed: expected at least 6 services/class types, got ${classTypeCount}.`);
  }

  if (futureSessionCount < 20) {
    throw new Error(`Seed verification failed: expected at least 20 future sessions, got ${futureSessionCount}.`);
  }

  if (purchasableOptionCount < 3) {
    throw new Error(
      `Seed verification failed: expected at least 3 purchasable booking options, got ${purchasableOptionCount}.`,
    );
  }
}

async function main() {
  const masterAdmin = await seedMasterAdmin();
  const primaryTeacher = await seedTeacher();
  const assistantTeacher = await seedAssistantTeacher();
  const clientOne = await seedClient();
  const clientTwo = await seedClientTwo();
  const clientThree = await seedClientThree();

  await seedCatalog();

  await seedScheduling({
    masterAdminId: masterAdmin.id,
    primaryTeacherId: primaryTeacher.id,
    assistantTeacherId: assistantTeacher.id,
  });

  await seedBookingOperations({
    masterAdminId: masterAdmin.id,
    primaryTeacherId: primaryTeacher.id,
    clientOneId: clientOne.id,
    clientTwoId: clientTwo.id,
    clientThreeId: clientThree.id,
  });

  await seedCommerce({
    masterAdminId: masterAdmin.id,
    clientOneId: clientOne.id,
    clientTwoId: clientTwo.id,
    clientThreeId: clientThree.id,
  });

  await seedAdminSupport({
    masterAdminId: masterAdmin.id,
    primaryTeacherId: primaryTeacher.id,
    clientOneId: clientOne.id,
    clientTwoId: clientTwo.id,
  });

  await verifySeedCoverage();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Seed failed", error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
