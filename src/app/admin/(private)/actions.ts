"use server";

import {
  BillingInterval,
  ClientMessageStatus,
  PaymentProvider,
  ProductType,
  Role,
  MarketingSubscriptionStatus,
  StudioSessionStatus,
  SubscriptionStatus,
  Weekday,
  Prisma,
  UserActivationStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@/auth";

import {
  addSessionAttendeeByManager,
  adjustAdminClientCredits,
  cancelAdminClientMembership,
  createAdminClass,
  createAdminClassCategory,
  cleanupAdminClassCreateFailure,
  cleanupAdminLearningProgramCreateFailure,
  updateAdminClassImage,
  createAdminLearningProgram,
  createAdminLearningVideo,
  createAdminPlan,
  createAdminSession,
  createAdminRecurringSessions,
  createAdminSubscription,
  createAdminUser,
  createAdminSiteWeeklyScheduleEntry,
  deleteAdminSiteWeeklyScheduleEntry,
  upsertAdminClassScheduleConfig,
  updateAdminClass,
  updateAdminCancellationPeriodHours,
  updateAdminSiteTimeZone,
  updateAdminLearningProgram,
  updateAdminLearningVideo,
  updateAdminPlan,
  updateAdminSession,
  updateAdminSiteWeeklyScheduleEntry,
  updateAdminSubscription,
  updateAdminTeacherImage,
  updateAdminUser,
  removeSessionAttendeeByManager,
  bulkAddClientMarketingSegments,
  bulkRemoveClientMarketingSegments,
  bulkSetClientMarketingSubscriptionStatus,
  resolveAdminActorUser,
} from "@/lib/admin/admin-service";
import { requireAdminSession } from "@/lib/auth/require-auth";
import { upsertActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";
import { updateClientMessageStatus } from "@/lib/client-messages/client-message-service";
import { isLearningImagePath } from "@/lib/learning/image-paths";
import {
  CanonicalMediaError,
  storeCanonicalImageWithPathPersistence,
  type CanonicalMediaFile,
  type CanonicalMediaFolder,
} from "@/lib/media";
import { normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";
import { clearPublicCatalogueCaches } from "@/lib/public-catalogue/catalogue-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";
import { revalidatePath } from "next/cache";

const classSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  defaultDurationMinutes: z.coerce.number().int().positive(),
  defaultCapacity: z.coerce.number().int().positive(),
  isActive: z.boolean(),
  isVisible: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
});

const classCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
});

const classScheduleSchema = z
  .object({
    defaultTeacherId: z.string().min(1),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    isRecurring: z.boolean(),
    date: z.date().nullable().optional(),
    weekdays: z.array(z.nativeEnum(Weekday)).optional(),
    endDate: z.date().nullable().optional(),
  })
  .superRefine((input, ctx) => {
    const [startHour, startMinute] = input.startTime.split(":").map((part) => Number.parseInt(part, 10));
    const [endHour, endMinute] = input.endTime.split(":").map((part) => Number.parseInt(part, 10));
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End time must be after start time.",
        path: ["endTime"],
      });
    }

    if (!input.isRecurring && !input.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Date is required for one-off classes.",
        path: ["date"],
      });
    }

    const weekdays = input.weekdays ?? [];
    if (input.isRecurring && weekdays.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select at least one weekday.",
        path: ["weekdays"],
      });
    }

    if (input.isRecurring && !input.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Start date is required.",
        path: ["date"],
      });
    }
    if (input.isRecurring && !input.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date is required.",
        path: ["endDate"],
      });
    }
    if (input.isRecurring && input.date && input.endDate && input.endDate < input.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date cannot be before start date.",
        path: ["endDate"],
      });
    }
  });

const sessionSchema = z
  .object({
    classTemplateId: z.string().min(1),
    teacherId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    capacity: z.coerce.number().int().positive(),
    status: z.nativeEnum(StudioSessionStatus),
    isPublished: z.boolean(),
  })
  .refine((input) => input.endsAt > input.startsAt, {
    message: "Session end time must be after start time.",
    path: ["endsAt"],
  });

const sessionBaseSchema = z.object({
  classTemplateId: z.string().min(1),
  teacherId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  capacity: z.coerce.number().int().positive(),
  status: z.nativeEnum(StudioSessionStatus),
  isPublished: z.boolean(),
});

const sessionAttendeeAddSchema = z.object({
  clientId: z.string().min(1),
  note: z.string().max(400).optional(),
  overrideReason: z.string().max(400).optional(),
});

const sessionAttendeeRemoveSchema = z.object({
  bookingId: z.string().min(1),
  note: z.string().max(400).optional(),
});

const sessionAttendanceUpdateSchema = z.object({
  bookingId: z.string().min(1),
  targetStatus: z.enum(["CHECKED_IN", "ATTENDED", "NO_SHOW", "CLEAR"]),
  note: z.string().max(400).optional(),
});

const recurringSessionSchema = z
  .object({
    startsOn: z.date(),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    repeatEveryWeeks: z.coerce.number().int().min(1).max(12),
    weekdays: z.array(z.nativeEnum(Weekday)).min(1),
    endMode: z.enum(["never", "on_date", "after_occurrences"]),
    endDate: z.date().nullable().optional(),
    occurrences: z.number().int().min(1).max(260).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    const [startHour, startMinute] = input.startTime.split(":").map((part) => Number.parseInt(part, 10));
    const [endHour, endMinute] = input.endTime.split(":").map((part) => Number.parseInt(part, 10));
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End time must be after start time.",
        path: ["endTime"],
      });
    }

    if (input.endMode === "on_date" && !input.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date is required.",
        path: ["endDate"],
      });
    }

    if (input.endMode === "after_occurrences" && !input.occurrences) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Occurrences are required.",
        path: ["occurrences"],
      });
    }
  });

const ALLOWED_PRODUCT_TYPES = [
  ProductType.DROP_IN_CLASS,
  ProductType.CLASS_PACK,
  ProductType.PRIVATE_PACK,
  ProductType.UNLIMITED_MEMBERSHIP,
] as const;

const planSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    productType: z.enum(ALLOWED_PRODUCT_TYPES.map(String) as [string, ...string[]]).transform((v) => v as ProductType),
    classPackCreditQuantity: z.coerce.number().int().positive().optional(),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0),
    priceName: z.string().optional(),
    currencyCode: z.string().length(3),
    unitAmount: z.coerce.number().positive(),
    billingInterval: z.nativeEnum(BillingInterval).optional(),
  })
  .superRefine((input, ctx) => {
    const isPackProduct =
      input.productType === ProductType.CLASS_PACK || input.productType === ProductType.PRIVATE_PACK;
    if (isPackProduct && input.classPackCreditQuantity === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Class pack credit quantity is required.",
        path: ["classPackCreditQuantity"],
      });
    }

    if (!isPackProduct && input.classPackCreditQuantity !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Pack credits are only allowed for class packs.",
        path: ["classPackCreditQuantity"],
      });
    }

    if (input.productType === ProductType.UNLIMITED_MEMBERSHIP) {
      if (!input.billingInterval) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Billing interval is required for memberships.",
          path: ["billingInterval"],
        });
      } else if (input.billingInterval !== BillingInterval.MONTH && input.billingInterval !== BillingInterval.YEAR) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Membership billing interval must be monthly or yearly.",
          path: ["billingInterval"],
        });
      }
      return;
    }

    if (input.billingInterval !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Billing interval is only allowed for unlimited memberships.",
        path: ["billingInterval"],
      });
    }
  });

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.email(),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
  marketingSubscriptionStatus: z.nativeEnum(MarketingSubscriptionStatus).optional(),
  marketingSegmentIds: z.array(z.string().min(1)).optional(),
  phone: z.string().optional(),
  notes: z.string().optional(),
  bio: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  hireDate: z.coerce.date().nullable().optional(),
  password: z.string().optional(),
});

const createSubscriptionSchema = z
  .object({
    clientId: z.string().min(1),
    productId: z.string().min(1),
    priceId: z.string().min(1),
    status: z.nativeEnum(SubscriptionStatus),
    startsAt: z.coerce.date(),
    currentPeriodStart: z.coerce.date(),
    currentPeriodEnd: z.coerce.date(),
    cancelAtPeriodEnd: z.boolean(),
    provider: z.nativeEnum(PaymentProvider),
    providerSubscriptionReference: z.string().optional(),
  })
  .refine((input) => input.currentPeriodEnd > input.currentPeriodStart, {
    message: "Current period end must be after current period start.",
    path: ["currentPeriodEnd"],
  });

const updateSubscriptionSchema = z
  .object({
    status: z.nativeEnum(SubscriptionStatus),
    currentPeriodStart: z.coerce.date(),
    currentPeriodEnd: z.coerce.date(),
    cancelAtPeriodEnd: z.boolean(),
    cancelledAt: z.coerce.date().nullable(),
    endedAt: z.coerce.date().nullable(),
    providerSubscriptionReference: z.string().optional(),
  })
  .refine((input) => input.currentPeriodEnd > input.currentPeriodStart, {
    message: "Current period end must be after current period start.",
    path: ["currentPeriodEnd"],
  });

const learningProgramSchema = z.object({
  mainTitle: z.string().min(1),
  mainDescription: z.string().optional(),
  courseType: z.string().min(1),
  title: z.string().min(1),
  description1: z.string().optional(),
  description2: z.string().optional(),
  description3: z.string().optional(),
  videoPromo: z.string().optional(),
  picture1: z.string().optional().refine((value) => !value || isLearningImagePath(value), "Learning images must use /images/learning/ JPG, PNG, or WEBP files."),
  picture2: z.string().optional().refine((value) => !value || isLearningImagePath(value), "Learning images must use /images/learning/ JPG, PNG, or WEBP files."),
  picture3: z.string().optional().refine((value) => !value || isLearningImagePath(value), "Learning images must use /images/learning/ JPG, PNG, or WEBP files."),
});

const learningVideoSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  category: z.string().min(1),
  categoryType: z.string().optional(),
  categoryLevel: z.string().optional(),
  thumbnail: z.string().optional().refine((value) => !value || isLearningImagePath(value), "Learning images must use /images/learning/ JPG, PNG, or WEBP files."),
  videoUrl: z.string().optional(),
  priority: z.coerce.number().int(),
});

const updateClientMessageStatusSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(ClientMessageStatus),
});

const adjustClientCreditsSchema = z
  .object({
    userId: z.string().min(1),
    entitlementId: z.string().optional(),
    productId: z.string().optional(),
    creditDelta: z.coerce.number().int(),
    expiresAt: z.coerce.date().nullable().optional(),
    reason: z.string().trim().min(1).max(400),
  })
  .refine((input) => input.creditDelta !== 0, {
    message: "Adjustment amount must be non-zero.",
    path: ["creditDelta"],
  })
  .refine((input) => Boolean(input.entitlementId || input.productId), {
    message: "A target entitlement or product is required.",
    path: ["entitlementId"],
  });

const cancelClientMembershipSchema = z.object({
  clientId: z.string().min(1),
  subscriptionContractId: z.string().min(1),
});

const MAX_CAMPAIGN_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_CAMPAIGN_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const marketingCampaignTestSchema = z.object({
  campaignId: z.string().min(1),
  toEmail: z.email(),
});

const marketingCampaignFlowStep1Schema = z.object({
  campaignId: z.string().min(1).optional(),
  campaignName: z.string().min(1),
  subject: z.string().min(1),
  previewText: z.string().min(1),
  contentJson: z.string().min(1),
});

const marketingCampaignFlowStep2Schema = z.object({
  campaignId: z.string().min(1),
  fromName: z.string().min(1),
  fromEmail: z.email(),
  replyTo: z.union([z.email(), z.literal("")]).optional(),
  categoryId: z.string().optional(),
});

const marketingCategoryCreateSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean(),
});

const marketingCategoryUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean(),
});

const marketingSegmentCreateSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean(),
});

const marketingSegmentUpdateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  isActive: z.boolean(),
});

const bulkClientMarketingStatusSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
  marketingSubscriptionStatus: z.nativeEnum(MarketingSubscriptionStatus),
});

const bulkClientMarketingSegmentsSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1),
  segmentIds: z.array(z.string().min(1)).min(1),
});

const siteWeeklyScheduleSchema = z
  .object({
    dayOfWeek: z.nativeEnum(Weekday),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    serviceId: z.string().min(1),
    displayOrder: z.coerce.number().int().min(0),
    isActive: z.boolean(),
  })
  .superRefine((input, ctx) => {
    const [startHour, startMinute] = input.startTime.split(":").map((part) => Number.parseInt(part, 10));
    const [endHour, endMinute] = input.endTime.split(":").map((part) => Number.parseInt(part, 10));
    if (endHour * 60 + endMinute <= startHour * 60 + startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End time must be after start time.",
        path: ["endTime"],
      });
    }
  });

const cancellationPeriodSchema = z.object({
  cancellationPeriodHours: z.coerce.number().int().positive(),
});

const siteTimeZoneSchema = z.object({
  timeZone: z.string().trim().min(1),
});

function isChecked(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function toNullableDate(value: FormDataEntryValue | null): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getPrismaErrorMessage(error: unknown): string {
  const prismaError = error as Prisma.PrismaClientKnownRequestError | undefined;
  if (prismaError?.code === "P2002") {
    return "A record with the same unique value already exists.";
  }
  if (prismaError?.code === "P2025") {
    return "The selected record no longer exists.";
  }

  return "Unexpected server error.";
}

function getAdminActionErrorMessage(error: unknown): string {
  if (error instanceof CanonicalMediaError) {
    if (error.code === "FILE_TOO_LARGE") {
      return "Image must be 5MB or less.";
    }
    if (
      error.code === "INVALID_MIME_TYPE" ||
      error.code === "INVALID_EXTENSION" ||
      error.code === "INVALID_MAGIC_BYTES"
    ) {
      return "Only valid JPG, PNG, or WEBP images are accepted.";
    }
    return "Invalid image upload.";
  }

  const code = error instanceof Error ? error.message : "";

  if (code === "INVALID_CREDIT_AMOUNT") {
    return "Credit delta must be a non-zero whole number.";
  }
  if (code === "ENTITLEMENT_NOT_FOUND") {
    return "Selected entitlement was not found for this user.";
  }
  if (code === "PRODUCT_REQUIRED") {
    return "Choose a product when creating new client credits.";
  }
  if (code === "POSITIVE_AMOUNT_REQUIRED") {
    return "New client credits must be a positive number.";
  }
  if (code === "PRODUCT_NOT_CREDIT_ELIGIBLE") {
    return "Selected product cannot be used to create client credits.";
  }
  if (code === "CREDIT_ADJUSTMENT_REASON_REQUIRED") {
    return "Audit reason is required for credit adjustments.";
  }
  if (code === "CREDIT_BALANCE_NEGATIVE_FORBIDDEN") {
    return "This adjustment would result in a negative credit balance.";
  }
  if (code === "SUBSCRIPTION_NOT_FOUND") {
    return "Selected membership could not be found for this user.";
  }
  if (code === "CLIENT_NOT_FOUND") {
    return "Client account was not found. Refresh the page and try again.";
  }
  if (code === "ADMIN_USER_NOT_FOUND") {
    return "Your admin session is no longer valid. Sign in again and retry.";
  }
  if (code === "USER_NOT_FOUND") {
    return "Selected user no longer exists. Refresh the page and retry.";
  }
  if (code === "MASTER_ADMIN_MANAGEMENT_FORBIDDEN") {
    return "Only MASTER_ADMIN can manage another MASTER_ADMIN.";
  }
  if (code === "MASTER_ADMIN_ASSIGNMENT_FORBIDDEN") {
    return "Only MASTER_ADMIN can assign MASTER_ADMIN role.";
  }
  if (code === "MARKETING_CLIENT_ONLY") {
    return "Marketing settings can only be managed for CLIENT users.";
  }
  if (code === "USERS_REQUIRED") {
    return "Select at least one CLIENT user.";
  }
  if (code === "SEGMENTS_REQUIRED") {
    return "Select at least one segment.";
  }
  if (code === "SEGMENTS_NOT_FOUND") {
    return "One or more selected segments no longer exist.";
  }
  if (code === "TEACHER_NOT_FOUND") {
    return "Teacher account was not found.";
  }
  if (code === "INVALID_SESSION_TIME_RANGE") {
    return "Session end time must be after start time.";
  }
  if (code === "INVALID_RECURRENCE_INTERVAL") {
    return "Recurring schedule must repeat every 1 to 12 weeks.";
  }
  if (code === "INVALID_RECURRENCE_WEEKDAYS") {
    return "Select at least one weekday for recurring sessions.";
  }
  if (code === "RECURRENCE_END_DATE_REQUIRED") {
    return "Recurring end date is required.";
  }
  if (code === "INVALID_RECURRENCE_DATE_RANGE") {
    return "Recurring end date cannot be before start date.";
  }
  if (code === "RECURRENCE_OCCURRENCES_REQUIRED") {
    return "Recurring occurrences count is required.";
  }
  if (code === "NO_RECURRENCE_OCCURRENCES") {
    return "No sessions were generated for this recurring schedule.";
  }
  if (code === "TEACHER_REQUIRED") {
    return "Choose a default teacher for this class schedule.";
  }
  if (code === "SCHEDULE_DATE_REQUIRED") {
    return "Choose a date for one-off class scheduling.";
  }
  if (code === "SESSION_MANAGER_FORBIDDEN") {
    return "You do not have permission to manage session attendees.";
  }
  if (code === "CLASS_NOT_FOUND") {
    return "Booking service not found.";
  }
  if (code === "SESSION_NOT_FOUND") {
    return "Session not found. Refresh and try again.";
  }
  if (code === "SESSION_NOT_BOOKABLE") {
    return "This session is no longer bookable.";
  }
  if (code === "SESSION_FULL") {
    return "This session is already full.";
  }
  if (code === "SESSION_ELIGIBILITY_REQUIRED") {
    return "Client must have an eligible credit or qualifying subscription for this class.";
  }
  if (code === "SESSION_OVERRIDE_REASON_REQUIRED") {
    return "Manual no-credit override requires a reason of at least 10 characters.";
  }
  if (code === "TEACHER_SESSION_FORBIDDEN") {
    return "You can only manage attendees for sessions assigned to you.";
  }
  if (code === "SESSION_ATTENDEE_NOT_FOUND") {
    return "Selected attendee booking was not found for this session.";
  }
  if (code === "BOOKING_NOT_CONFIRMED") {
    return "Attendance can be managed only for confirmed bookings.";
  }
  if (code === "ATTENDANCE_NOT_FOUND") {
    return "No check-in record exists to clear.";
  }
  if (code === "ATTENDANCE_ALREADY_FINALIZED") {
    return "Attendance is finalized and cannot be changed from this state.";
  }
  if (code === "INVALID_SITE_SCHEDULE_TIME" || code === "INVALID_SITE_SCHEDULE_TIME_RANGE") {
    return "Schedule start and end time are invalid.";
  }
  if (code === "INVALID_SITE_SCHEDULE_SERVICE") {
    return "Choose a booking service.";
  }
  if (code === "INVALID_CANCELLATION_CUTOFF_HOURS") {
    return "Cancellation period must be a positive whole number of hours.";
  }
  if (code === "INVALID_CURRENCY_CODE") {
    return "Currency must be a valid 3-letter ISO code (for example EUR).";
  }
  if (code === "INVALID_UNIT_AMOUNT") {
    return "Price amount must be greater than zero.";
  }
  if (code === "RECURRING_INTERVAL_REQUIRED") {
    return "Unlimited memberships require a billing interval.";
  }
  if (code === "BILLING_INTERVAL_INVALID_FOR_MEMBERSHIP") {
    return "Membership billing interval must be monthly or yearly.";
  }
  if (code === "INVALID_BILLING_INTERVAL_COUNT") {
    return "Billing interval count must be 1 for memberships.";
  }
  if (code === "CLASS_PACK_QUANTITY_REQUIRED") {
    return "Pack credits are required for CLASS_PACK and PRIVATE_PACK products.";
  }
  if (code === "CLASS_PACK_QUANTITY_INVALID") {
    return "Pack credits must be a positive whole number.";
  }
  if (code === "CLASS_PACK_QUANTITY_NOT_ALLOWED") {
    return "Pack credits can only be set for CLASS_PACK and PRIVATE_PACK products.";
  }
  if (code === "PRICE_TYPE_DERIVATION_MISMATCH") {
    return "Billing type is derived from product type and cannot be changed manually.";
  }
  if (code === "ONE_TIME_INTERVAL_FORBIDDEN") {
    return "Billing interval can only be set for unlimited memberships.";
  }
  if (code === "PRODUCT_NOT_FOUND") {
    return "Selected plan no longer exists. Refresh and try again.";
  }

  return getPrismaErrorMessage(error);
}

type AdminSession = Awaited<ReturnType<typeof requireAdminSession>>;
type SessionManagerSession = {
  user: {
    id: string;
    role: Role;
  };
};

async function assertAdminAccess(): Promise<AdminSession> {
  await assertSameOriginServerAction();
  return requireAdminSession({ throwOnFailure: true });
}

async function assertSessionManagerAccess(): Promise<SessionManagerSession> {
  await assertSameOriginServerAction();
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("UNAUTHENTICATED");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, activationStatus: true, isActive: true },
  });

  if (!user || !user.isActive || user.activationStatus !== UserActivationStatus.ACTIVE) {
    throw new Error("UNAUTHENTICATED");
  }

  const role = user.role as Role;
  if (role !== Role.ADMIN && role !== Role.MASTER_ADMIN && role !== Role.TEACHER) {
    throw new Error("FORBIDDEN");
  }

  return {
    user: {
      id: session.user.id,
      role,
    },
  };
}

function redirectWithError(path: string, message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}error=${encodeURIComponent(message)}`);
}

function toStringArray(value: FormDataEntryValue | null): string[] {
  const raw = String(value ?? "");
  return raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toStringArrayFromEntries(values: FormDataEntryValue[]): string[] {
  return values.map((value) => String(value).trim()).filter(Boolean);
}

function toWeekdayArray(values: FormDataEntryValue[]): Weekday[] {
  const allowed = new Set(Object.values(Weekday));
  const normalized = toStringArrayFromEntries(values).filter((value): value is Weekday => allowed.has(value as Weekday));
  return [...new Set(normalized)];
}

function toOptionalTrimmedString(value: FormDataEntryValue | null): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : undefined;
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9\-_]/g, "");
}

function mapTeacherImageMimeTypeToExtension(mimeType: string): string | null {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }

  return null;
}

function getOptionalImageFile(formData: FormData, fieldName: string): CanonicalMediaFile | null {
  const file = formData.get(fieldName);
  if (!(file instanceof File) || file.size < 1) {
    return null;
  }

  return file;
}

async function storeAdminImageWithPersistence(input: {
  file: CanonicalMediaFile;
  folder: CanonicalMediaFolder;
  filenamePrefix: string;
  persistPath: (publicPath: string) => Promise<void>;
}) {
  return storeCanonicalImageWithPathPersistence({
    file: input.file,
    folder: input.folder,
    filenamePrefix: input.filenamePrefix,
    persistPath: input.persistPath,
  });
}

async function cleanupStoredMediaFiles(absolutePaths: readonly string[]) {
  await Promise.all(
    absolutePaths.map(async (absolutePath) => {
      try {
        await unlink(absolutePath);
      } catch {
        // Best effort cleanup for failed create flows.
      }
    }),
  );
}

type LearningProgramPayload = z.infer<typeof learningProgramSchema>;
type LearningProgramImageField = "picture1" | "picture2" | "picture3";

async function storeLearningProgramImageUploadsForCreate(input: {
  formData: FormData;
  payload: LearningProgramPayload;
}): Promise<{ payload: LearningProgramPayload; absolutePaths: string[] }> {
  const payload: LearningProgramPayload = { ...input.payload };
  const absolutePaths: string[] = [];
  const fields: LearningProgramImageField[] = ["picture1", "picture2", "picture3"];

  try {
    for (const field of fields) {
      const upload = getOptionalImageFile(input.formData, `${field}Upload`);
      if (!upload) {
        continue;
      }

      const stored = await storeAdminImageWithPersistence({
        file: upload,
          folder: "learning",
        filenamePrefix: `program-${payload.courseType}-${field}`,
        persistPath: async () => undefined,
      });
      absolutePaths.push(stored.absolutePath);
      payload[field] = stored.publicPath;
    }
  } catch (error) {
    await cleanupStoredMediaFiles(absolutePaths);
    throw error;
  }

  return { payload, absolutePaths };
}

async function persistLearningProgramImageUploads(input: {
  formData: FormData;
  programId: string;
  payload: LearningProgramPayload;
}) {
  const payload: LearningProgramPayload = { ...input.payload };
  const fields: LearningProgramImageField[] = ["picture1", "picture2", "picture3"];

  for (const field of fields) {
    const upload = getOptionalImageFile(input.formData, `${field}Upload`);
    if (!upload) {
      continue;
    }

    await storeAdminImageWithPersistence({
      file: upload,
      folder: "learning",
      filenamePrefix: `program-${input.programId}-${field}`,
      persistPath: async (publicPath) => {
        payload[field] = publicPath;
        await updateAdminLearningProgram(input.programId, payload);
      },
    });
  }
}

async function storeCampaignImageAsset(file: File, campaignId: string): Promise<string> {
  if (file.size > MAX_CAMPAIGN_IMAGE_FILE_SIZE_BYTES) {
    throw new Error("CAMPAIGN_IMAGE_TOO_LARGE");
  }
  if (!ALLOWED_CAMPAIGN_IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error("CAMPAIGN_IMAGE_TYPE_INVALID");
  }

  const extension = mapTeacherImageMimeTypeToExtension(file.type);
  if (!extension) {
    throw new Error("CAMPAIGN_IMAGE_TYPE_INVALID");
  }

  const bytes = await file.arrayBuffer();
  const imagesDir = join(process.cwd(), "public", "images", "marketing");
  const targetFileName = `campaign-${sanitizeFilenamePart(campaignId)}-${Date.now()}.${extension}`;
  const targetAbsolutePath = join(imagesDir, targetFileName);
  const relativePath = `/images/marketing/${targetFileName}`;

  await mkdir(imagesDir, { recursive: true });
  await writeFile(targetAbsolutePath, Buffer.from(bytes));
  return relativePath;
}

function getMarketingActionErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";

  if (code === "MARKETING_CAMPAIGN_NOT_FOUND") {
    return "Campaign not found.";
  }
  if (code === "MARKETING_CAMPAIGN_NOT_DRAFT") {
    return "Only draft campaigns can be changed or sent.";
  }
  if (code === "MARKETING_CAMPAIGN_ALREADY_SENT") {
    return "This campaign was already sent and cannot be sent again.";
  }
  if (code === "MARKETING_FLOW_SEND_STEP_INVALID") {
    return "Final send is only available from Step 4 confirmation.";
  }
  if (code === "MARKETING_FLOW_INVALID_SENDER") {
    return "Sender details are invalid. Use a valid from email and reply-to address.";
  }
  if (code === "MARKETING_CAMPAIGN_DELIVERY_INCOMPLETE") {
    return "Campaign delivery failed for one or more recipients. Campaign remains in sending state.";
  }
  if (code === "MARKETING_FLOW_TEST_DRAFT_REQUIRED") {
    return "Save the campaign draft before sending a test email.";
  }
  if (code === "MARKETING_FLOW_TEST_PREVIEW_RENDER_FAILED") {
    return "The campaign preview could not be rendered for test send.";
  }
  if (code === "MARKETING_TEST_EMAIL_INVALID") {
    return "Enter a valid test email address.";
  }
  if (code === "ADMIN_USER_NOT_FOUND") {
    return "Could not create the campaign draft because the current admin user could not be resolved. Please sign in again.";
  }
  if (code === "MARKETING_DRAFT_SHELL_CREATE_FAILED") {
    return "Could not create the campaign draft shell. Please retry.";
  }
  if (code === "MARKETING_DRAFT_SHELL_UPDATE_FAILED") {
    return "Could not update the campaign draft shell. Please retry.";
  }
  if (code === "MARKETING_DRAFT_RENDER_INVALID_CONTENT" || code === "MARKETING_DRAFT_PREVIEW_RENDER_FAILED") {
    return "Draft was generated but preview rendering failed.";
  }
  if (code === "MARKETING_DRAFT_PERSIST_FAILED") {
    return "Draft generation succeeded but saving the draft failed.";
  }
  if (code === "MARKETING_TEST_SEND_FAILED") {
    return "Test email failed to send.";
  }
  if (code === "CAMPAIGN_IMAGE_TOO_LARGE") {
    return "Campaign image must be 5MB or less.";
  }
  if (code === "CAMPAIGN_IMAGE_TYPE_INVALID") {
    return "Only JPG, PNG, or WEBP campaign images are accepted.";
  }

  return getPrismaErrorMessage(error);
}

function getStep1ValidationErrorMessage(error: z.ZodError<z.infer<typeof marketingCampaignFlowStep1Schema>>): string {
  for (const issue of error.issues) {
    const path = issue.path[0];
    if (path === "campaignName") {
      return "Campaign name is required.";
    }
    if (path === "subject") {
      return "Subject is required.";
    }
    if (path === "previewText") {
      return "Preview text is required.";
    }
    if (path === "contentJson") {
      return "Campaign content blocks are required.";
    }
  }
  return "Please complete all required campaign fields.";
}

function isRedirectException(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { digest?: unknown; message?: unknown };
  const digest = typeof maybeError.digest === "string" ? maybeError.digest : "";
  if (digest.startsWith("NEXT_REDIRECT")) {
    return true;
  }

  const message = typeof maybeError.message === "string" ? maybeError.message : "";
  return message.startsWith("NEXT_REDIRECT");
}

function buildMarketingFlowReviewHref(input: {
  campaignId: string;
  segmentIds?: string[];
  page?: number;
  testEmail?: string;
  success?: string;
  error?: string;
}): string {
  const query = new URLSearchParams();
  for (const segmentId of input.segmentIds ?? []) {
    if (segmentId) {
      query.append("segments", segmentId);
    }
  }
  if (input.page && Number.isFinite(input.page) && input.page > 0) {
    query.set("page", String(input.page));
  }
  if (input.testEmail?.trim()) {
    query.set("testEmail", input.testEmail.trim().toLowerCase());
  }
  if (input.success) {
    query.set("success", input.success);
  }
  if (input.error) {
    query.set("error", input.error);
  }

  return `/admin/marketing/campaigns/${input.campaignId}/review${query.toString() ? `?${query.toString()}` : ""}`;
}

export async function createClassAction(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.createClassAction",
    { recordResponse: false },
    async () => {
      await assertAdminAccess();

      const parsed = classSchema.safeParse({
        categoryId: formData.get("categoryId"),
        name: formData.get("name"),
        description: formData.get("description") ?? undefined,
        defaultDurationMinutes: formData.get("defaultDurationMinutes"),
        defaultCapacity: formData.get("defaultCapacity"),
        isActive: isChecked(formData, "isActive"),
        isVisible: isChecked(formData, "isVisible"),
        sortOrder: formData.get("sortOrder"),
      });

      if (!parsed.success) {
        redirectWithError("/admin/classes/new", "Please complete all required class fields.");
      }

      const scheduleParsed = classScheduleSchema.safeParse({
        defaultTeacherId: formData.get("defaultTeacherId"),
        startTime: formData.get("scheduleStartTime"),
        endTime: formData.get("scheduleEndTime"),
        isRecurring: isChecked(formData, "isRecurring"),
        date: toNullableDate(formData.get("scheduleDate")),
        weekdays: formData
          .getAll("repeatWeekdays")
          .map((value) => String(value).trim())
          .filter(Boolean),
        endDate: toNullableDate(formData.get("endDate")),
      });

      if (!scheduleParsed.success) {
        redirectWithError("/admin/classes/new", "Please complete all required class schedule fields.");
      }

      const classImage = getOptionalImageFile(formData, "classImage");
      if (!classImage) {
        redirectWithError("/admin/classes/new", "Please select a service image file.");
      }

      try {
        await storeAdminImageWithPersistence({
          file: classImage,
          folder: "classes",
          filenamePrefix: `service-${parsed.data.name}`,
          persistPath: async (publicPath) => {
            let createdClassId: string | null = null;
            try {
              const createdClass = await createAdminClass({ ...parsed.data, imageUrl: publicPath });
              createdClassId = createdClass.id;
              await upsertAdminClassScheduleConfig({
                classTypeId: createdClass.id,
                className: createdClass.name,
                defaultCapacity: createdClass.defaultCapacity,
                defaultDurationMinutes: createdClass.defaultDurationMinutes,
                defaultTeacherId: scheduleParsed.data.defaultTeacherId,
                startTime: scheduleParsed.data.startTime,
                endTime: scheduleParsed.data.endTime,
                isRecurring: scheduleParsed.data.isRecurring,
                date: scheduleParsed.data.date ?? null,
                weekdays: scheduleParsed.data.weekdays ?? [],
                endDate: scheduleParsed.data.endDate ?? null,
              });
            } catch (error) {
              if (createdClassId) {
                try {
                  await cleanupAdminClassCreateFailure(createdClassId);
                } catch {
                  // Preserve the original schedule/persistence failure for callers.
                }
              }
              throw error;
            }
          },
        });
        clearPublicCatalogueCaches();
        revalidatePath("/admin/classes");
      } catch (error) {
        Sentry.captureException(error);
        redirectWithError("/admin/classes/new", getAdminActionErrorMessage(error));
      }

      redirect("/admin/classes");
    },
  );
}

export async function createClassCategoryAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = classCategorySchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    isActive: isChecked(formData, "isActive"),
    sortOrder: formData.get("sortOrder"),
  });

  if (!parsed.success) {
    redirectWithError("/admin/classes", "Please complete all required category fields.");
  }

  try {
    await createAdminClassCategory(parsed.data);
    clearPublicCatalogueCaches();
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError("/admin/classes", getAdminActionErrorMessage(error));
  }

  revalidatePath("/admin/classes");
  redirect(`/admin/classes?success=${encodeURIComponent("Category created.")}`);
}

export async function updateClassAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = classSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    defaultDurationMinutes: formData.get("defaultDurationMinutes"),
    defaultCapacity: formData.get("defaultCapacity"),
    isActive: isChecked(formData, "isActive"),
    isVisible: isChecked(formData, "isVisible"),
    sortOrder: formData.get("sortOrder"),
  });

  if (!parsed.success) {
    redirectWithError(`/admin/classes/${id}/edit`, "Please complete all required class fields.");
  }

  const scheduleParsed = classScheduleSchema.safeParse({
    defaultTeacherId: formData.get("defaultTeacherId"),
    startTime: formData.get("scheduleStartTime"),
    endTime: formData.get("scheduleEndTime"),
    isRecurring: isChecked(formData, "isRecurring"),
    date: toNullableDate(formData.get("scheduleDate")),
    weekdays: formData
      .getAll("repeatWeekdays")
      .map((value) => String(value).trim())
      .filter(Boolean),
    endDate: toNullableDate(formData.get("endDate")),
  });

  if (!scheduleParsed.success) {
    redirectWithError(`/admin/classes/${id}/edit`, "Please complete all required class schedule fields.");
  }

  try {
    const updatedClass = await updateAdminClass(id, parsed.data);
    await upsertAdminClassScheduleConfig({
      classTypeId: updatedClass.id,
      className: updatedClass.name,
      defaultCapacity: updatedClass.defaultCapacity,
      defaultDurationMinutes: updatedClass.defaultDurationMinutes,
      defaultTeacherId: scheduleParsed.data.defaultTeacherId,
      startTime: scheduleParsed.data.startTime,
      endTime: scheduleParsed.data.endTime,
      isRecurring: scheduleParsed.data.isRecurring,
      date: scheduleParsed.data.date ?? null,
      weekdays: scheduleParsed.data.weekdays ?? [],
      endDate: scheduleParsed.data.endDate ?? null,
    });
    revalidatePath("/admin/classes");
    clearPublicCatalogueCaches();
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(`/admin/classes/${id}/edit`, getAdminActionErrorMessage(error));
  }

  redirect("/admin/classes");
}

export async function createSessionAction(formData: FormData) {
  await assertAdminAccess();

  const baseParsed = sessionBaseSchema.safeParse({
    classTemplateId: formData.get("classTemplateId"),
    teacherId: formData.get("teacherId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    location: formData.get("location") ?? undefined,
    capacity: formData.get("capacity"),
    status: formData.get("status"),
    isPublished: isChecked(formData, "isPublished"),
  });

  if (!baseParsed.success) {
    redirectWithError("/admin/sessions/new", "Please complete all required session fields.");
  }

  const scheduleMode = String(formData.get("scheduleMode") ?? "one_off").trim();

  try {
    if (scheduleMode === "recurring") {
      const recurringWeekdays = formData
        .getAll("recurringWeekdays")
        .map((value) => String(value).trim())
        .filter(Boolean);
      const recurringParsed = recurringSessionSchema.safeParse({
        startsOn: toNullableDate(formData.get("recurringStartsOn")),
        startTime: formData.get("recurringStartTime"),
        endTime: formData.get("recurringEndTime"),
        repeatEveryWeeks: formData.get("recurrenceEveryWeeks"),
        weekdays: recurringWeekdays,
        endMode: formData.get("recurrenceEndMode"),
        endDate: toNullableDate(formData.get("recurrenceEndDate")),
        occurrences: (() => {
          const raw = String(formData.get("recurrenceOccurrences") ?? "").trim();
          return raw ? Number.parseInt(raw, 10) : null;
        })(),
      });

      if (!recurringParsed.success) {
        redirectWithError("/admin/sessions/new", "Please complete all required session fields.");
      }

      await createAdminRecurringSessions({
        ...baseParsed.data,
        schedule: {
          ...recurringParsed.data,
          occurrences: recurringParsed.data.occurrences ?? undefined,
          endDate: recurringParsed.data.endDate ?? undefined,
        },
      });
    } else {
      const parsed = sessionSchema.safeParse({
        ...baseParsed.data,
        startsAt: formData.get("startsAt"),
        endsAt: formData.get("endsAt"),
      });

      if (!parsed.success) {
        redirectWithError("/admin/sessions/new", "Please complete all required session fields.");
      }

      await createAdminSession(parsed.data);
    }
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError("/admin/sessions/new", getAdminActionErrorMessage(error));
  }

  redirect("/admin/sessions");
}

export async function updateSessionAction(id: string, formData: FormData) {
  await assertAdminAccess();
  const returnTo = `/admin/sessions/${id}/edit`;

  const parsed = sessionSchema.safeParse({
    classTemplateId: formData.get("classTemplateId"),
    teacherId: formData.get("teacherId"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    location: formData.get("location") ?? undefined,
    startsAt: formData.get("startsAt"),
    endsAt: formData.get("endsAt"),
    capacity: formData.get("capacity"),
    status: formData.get("status"),
    isPublished: isChecked(formData, "isPublished"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete all required session fields.");
  }

  try {
    await updateAdminSession(id, parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Session updated.")}`);
}

export async function addSessionAttendeeAction(id: string, formData: FormData) {
  const session = await assertSessionManagerAccess();
  const returnTo = `/admin/sessions/${id}/edit`;

  const parsed = sessionAttendeeAddSchema.safeParse({
    clientId: formData.get("clientId"),
    note: toOptionalTrimmedString(formData.get("note")),
    overrideReason: toOptionalTrimmedString(formData.get("overrideReason")),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please choose a client to add.");
  }

  try {
    await addSessionAttendeeByManager({
      studioSessionId: id,
      clientId: parsed.data.clientId,
      note: parsed.data.note,
      overrideReason: parsed.data.overrideReason,
      actor: {
        userId: session.user.id,
        role: session.user.role,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendee added.")}`);
}

export async function removeSessionAttendeeAction(id: string, formData: FormData) {
  const session = await assertSessionManagerAccess();
  const returnTo = `/admin/sessions/${id}/edit`;

  const parsed = sessionAttendeeRemoveSchema.safeParse({
    bookingId: formData.get("bookingId"),
    note: toOptionalTrimmedString(formData.get("note")),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please select a valid attendee to remove.");
  }

  try {
    await removeSessionAttendeeByManager({
      studioSessionId: id,
      bookingId: parsed.data.bookingId,
      note: parsed.data.note,
      actor: {
        userId: session.user.id,
        role: session.user.role,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendee removed.")}`);
}

export async function updateSessionAttendanceAction(id: string, formData: FormData) {
  const session = await assertSessionManagerAccess();
  const returnTo = `/admin/sessions/${id}/edit`;

  const parsed = sessionAttendanceUpdateSchema.safeParse({
    bookingId: formData.get("bookingId"),
    targetStatus: formData.get("targetStatus"),
    note: toOptionalTrimmedString(formData.get("note")),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please submit a valid attendance update.");
  }

  try {
    const { markBookingAttendanceByStaff } = await import("@/lib/attendance/attendance-service");
    await markBookingAttendanceByStaff({
      bookingId: parsed.data.bookingId,
      studioSessionId: id,
      actorUserId: session.user.id,
      targetStatus: parsed.data.targetStatus,
      notes: parsed.data.note,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Attendance updated.")}`);
}

export async function createPlanAction(formData: FormData) {
  const session = await assertAdminAccess();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    productType: formData.get("productType"),
    classPackCreditQuantity: formData.get("classPackCreditQuantity") || undefined,
    isActive: isChecked(formData, "isActive"),
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    currencyCode: String(formData.get("currencyCode") ?? "").toUpperCase(),
    unitAmount: formData.get("unitAmount"),
    billingInterval: formData.get("billingInterval") || undefined,
  });

  if (!parsed.success) {
    redirectWithError("/admin/plans/new", "Please complete all required plan fields.");
  }

  try {
    await createAdminPlan({
      actor: {
        actorId: session.user.id,
        actorRole: session.user.role,
      },
      name: parsed.data.name,
      description: parsed.data.description,
      productType: parsed.data.productType,
      classPackCreditQuantity:
        parsed.data.productType === ProductType.CLASS_PACK ||
        parsed.data.productType === ProductType.PRIVATE_PACK
          ? parsed.data.classPackCreditQuantity
          : undefined,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      currencyCode: parsed.data.currencyCode,
      unitAmountMinor: Math.round(parsed.data.unitAmount * 100),
      billingInterval:
        parsed.data.productType === ProductType.UNLIMITED_MEMBERSHIP
          ? parsed.data.billingInterval
          : undefined,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError("/admin/plans/new", getAdminActionErrorMessage(error));
  }

  redirect("/admin/plans");
}

export async function updatePlanAction(id: string, formData: FormData) {
  const session = await assertAdminAccess();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    productType: formData.get("productType"),
    classPackCreditQuantity: formData.get("classPackCreditQuantity") || undefined,
    isActive: isChecked(formData, "isActive"),
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    currencyCode: String(formData.get("currencyCode") ?? "").toUpperCase(),
    unitAmount: formData.get("unitAmount"),
    billingInterval: formData.get("billingInterval") || undefined,
  });

  if (!parsed.success) {
    redirectWithError(`/admin/plans/${id}/edit`, "Please complete all required plan fields.");
  }

  try {
    await updateAdminPlan(id, {
      actor: {
        actorId: session.user.id,
        actorRole: session.user.role,
      },
      name: parsed.data.name,
      description: parsed.data.description,
      productType: parsed.data.productType,
      classPackCreditQuantity:
        parsed.data.productType === ProductType.CLASS_PACK ||
        parsed.data.productType === ProductType.PRIVATE_PACK
          ? parsed.data.classPackCreditQuantity
          : undefined,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      currencyCode: parsed.data.currencyCode,
      unitAmountMinor: Math.round(parsed.data.unitAmount * 100),
      billingInterval:
        parsed.data.productType === ProductType.UNLIMITED_MEMBERSHIP
          ? parsed.data.billingInterval
          : undefined,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(`/admin/plans/${id}/edit`, getAdminActionErrorMessage(error));
  }

  redirect("/admin/plans");
}

export async function createUserAction(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.createUserAction",
    { recordResponse: false },
    async () => {
      const session = await assertAdminAccess();

      const parsed = createUserSchema.safeParse({
        name: formData.get("name"),
        email: formData.get("email"),
        role: formData.get("role"),
        isActive: isChecked(formData, "isActive"),
        password: formData.get("password"),
      });

      if (!parsed.success) {
        redirectWithError("/admin/users/new", "Please complete all required user fields.");
      }

      if (session.user.role === Role.ADMIN && parsed.data.role === Role.MASTER_ADMIN) {
        redirectWithError(
          "/admin/users/new",
          getAdminActionErrorMessage(new Error("MASTER_ADMIN_ASSIGNMENT_FORBIDDEN")),
        );
      }

      try {
        await createAdminUser({
          ...parsed.data,
          createdByUserId: session.user.id,
        });
      } catch (error) {
        Sentry.captureException(error);
        const mappedAdminMessage = getAdminActionErrorMessage(error);
        const message =
          mappedAdminMessage === "Unexpected server error."
            ? getPrismaErrorMessage(error)
            : mappedAdminMessage;
        redirectWithError("/admin/users/new", message);
      }

      redirect("/admin/users");
    },
  );
}

export async function updateUserAction(id: string, formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.updateUserAction",
    { recordResponse: false },
    async () => {
      const session = await assertAdminAccess();
      const returnPath = `/admin/users/${id}/edit`;

      const parsed = updateUserSchema.safeParse({
        firstName: formData.get("firstName"),
        lastName: formData.get("lastName"),
        email: formData.get("email"),
        role: formData.get("role"),
        isActive: isChecked(formData, "isActive"),
        marketingSubscriptionStatus: String(formData.get("marketingSubscriptionStatus") ?? "").trim() || undefined,
        marketingSegmentIds: toStringArrayFromEntries(formData.getAll("marketingSegmentIds")),
        phone: formData.get("phone") ?? undefined,
        notes: formData.get("notes") ?? undefined,
        bio: formData.get("bio") ?? undefined,
        specialties: toStringArray(formData.get("specialties")),
        certifications: toStringArray(formData.get("certifications")),
        hireDate: toNullableDate(formData.get("hireDate")),
        password: formData.get("password") || undefined,
      });

      if (!parsed.success) {
        redirectWithError(returnPath, "Please complete required user fields.");
      }

      try {
        const payload =
          parsed.data.role === Role.CLIENT
            ? parsed.data
            : {
                ...parsed.data,
                marketingSubscriptionStatus: undefined,
                marketingSegmentIds: undefined,
              };

        await updateAdminUser(id, payload, {
          id: session.user.id,
          role: session.user.role,
        });
      } catch (error) {
        Sentry.captureException(error);
        redirectWithError(returnPath, getAdminActionErrorMessage(error));
      }

      revalidatePath(returnPath);
      redirect(`${returnPath}?success=${encodeURIComponent("User updated.")}`);
    },
  );
}

export async function adjustClientCreditsAction(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.adjustClientCreditsAction",
    { recordResponse: false },
    async () => {
      const session = await assertAdminAccess();
      const userId =
        String(formData.get("userId") ?? "").trim() ||
        String(formData.get("clientId") ?? "").trim();
      const returnPath = userId ? `/admin/users/${userId}/edit` : "/admin/users";
      const rawEntitlementId = String(formData.get("entitlementId") ?? "").trim();
      const rawProductId = String(formData.get("productId") ?? "").trim();

      const parsed = adjustClientCreditsSchema.safeParse({
        userId,
        entitlementId: rawEntitlementId || undefined,
        productId: rawProductId || undefined,
        creditDelta: formData.get("creditDelta") ?? formData.get("amount"),
        expiresAt: toNullableDate(formData.get("expiresAt")),
        reason: String(formData.get("reason") ?? ""),
      });

      if (!parsed.success) {
        console.error("[admin/adjust-client-credits] validation_failed", {
          userId,
          rawEntitlementId,
          rawProductId,
          rawCreditDelta: String(formData.get("creditDelta") ?? formData.get("amount") ?? ""),
          rawExpiresAt: String(formData.get("expiresAt") ?? ""),
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
        redirectWithError(returnPath, "Invalid credits update payload.");
      }

      try {
        await adjustAdminClientCredits({
          clientId: parsed.data.userId,
          amount: parsed.data.creditDelta,
          entitlementId: parsed.data.entitlementId,
          productId: parsed.data.productId,
          expiresAt: parsed.data.expiresAt,
          reason: parsed.data.reason,
          adminUserId: session.user.id,
        });
      } catch (error) {
        Sentry.captureException(error);
        console.error("[admin/adjust-client-credits] service_failed", {
          userId: parsed.data.userId,
          entitlementId: parsed.data.entitlementId ?? null,
          productId: parsed.data.productId ?? null,
          creditDelta: parsed.data.creditDelta,
          expiresAt: parsed.data.expiresAt?.toISOString() ?? null,
          reason: parsed.data.reason ?? null,
          adminUserId: session.user.id,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        redirectWithError(returnPath, getAdminActionErrorMessage(error));
      }

      revalidatePath(returnPath);
      redirect(`${returnPath}?success=${encodeURIComponent("Credits updated.")}`);
    },
  );
}

export async function cancelClientMembershipAction(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.cancelClientMembershipAction",
    { recordResponse: false },
    async () => {
      await assertAdminAccess();

      const parsed = cancelClientMembershipSchema.safeParse({
        clientId: formData.get("clientId"),
        subscriptionContractId: formData.get("subscriptionContractId"),
      });
      const returnPath = `/admin/users/${String(formData.get("clientId") ?? "").trim()}/edit`;

      if (!parsed.success) {
        redirectWithError(returnPath, "Invalid membership cancellation payload.");
      }

      try {
        await cancelAdminClientMembership(parsed.data);
      } catch (error) {
        Sentry.captureException(error);
        redirectWithError(returnPath, getAdminActionErrorMessage(error));
      }

      revalidatePath(returnPath);
      redirect(`${returnPath}?success=${encodeURIComponent("Membership cancelled.")}`);
    },
  );
}

export async function createSubscriptionAction(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.createSubscriptionAction",
    { recordResponse: false },
    async () => {
      await assertAdminAccess();

      const parsed = createSubscriptionSchema.safeParse({
        clientId: formData.get("clientId"),
        productId: formData.get("productId"),
        priceId: formData.get("priceId"),
        status: formData.get("status"),
        startsAt: formData.get("startsAt"),
        currentPeriodStart: formData.get("currentPeriodStart"),
        currentPeriodEnd: formData.get("currentPeriodEnd"),
        cancelAtPeriodEnd: isChecked(formData, "cancelAtPeriodEnd"),
        provider: formData.get("provider"),
        providerSubscriptionReference: formData.get("providerSubscriptionReference") ?? undefined,
      });

      if (!parsed.success) {
        redirectWithError("/admin/subscriptions/new", "Please complete all required subscription fields.");
      }

      try {
        await createAdminSubscription(parsed.data);
      } catch (error) {
        Sentry.captureException(error);
        redirectWithError("/admin/subscriptions/new", getPrismaErrorMessage(error));
      }

      redirect("/admin/subscriptions");
    },
  );
}

export async function updateSubscriptionAction(id: string, formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "admin.updateSubscriptionAction",
    { recordResponse: false },
    async () => {
      await assertAdminAccess();

      const parsed = updateSubscriptionSchema.safeParse({
        status: formData.get("status"),
        currentPeriodStart: formData.get("currentPeriodStart"),
        currentPeriodEnd: formData.get("currentPeriodEnd"),
        cancelAtPeriodEnd: isChecked(formData, "cancelAtPeriodEnd"),
        cancelledAt: toNullableDate(formData.get("cancelledAt")),
        endedAt: toNullableDate(formData.get("endedAt")),
        providerSubscriptionReference: formData.get("providerSubscriptionReference") ?? undefined,
      });

      if (!parsed.success) {
        redirectWithError(`/admin/subscriptions/${id}/edit`, "Please complete required subscription fields.");
      }

      try {
        await updateAdminSubscription(id, parsed.data);
      } catch (error) {
        Sentry.captureException(error);
        redirectWithError(`/admin/subscriptions/${id}/edit`, getPrismaErrorMessage(error));
      }

      redirect("/admin/subscriptions");
    },
  );
}

export async function createLearningProgramAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = learningProgramSchema.safeParse({
    mainTitle: formData.get("mainTitle"),
    mainDescription: formData.get("mainDescription") ?? undefined,
    courseType: formData.get("courseType"),
    title: formData.get("title"),
    description1: formData.get("description1") ?? undefined,
    description2: formData.get("description2") ?? undefined,
    description3: formData.get("description3") ?? undefined,
    videoPromo: formData.get("videoPromo") ?? undefined,
    picture1: formData.get("picture1") ?? undefined,
    picture2: formData.get("picture2") ?? undefined,
    picture3: formData.get("picture3") ?? undefined,
  });

  if (!parsed.success) {
    redirectWithError("/admin/learning-programs/new", "Please complete all required learning program fields.");
  }

  const storedUploadPaths: string[] = [];
  let createdProgramId: string | null = null;
  try {
    const prepared = await storeLearningProgramImageUploadsForCreate({
      formData,
      payload: parsed.data,
    });
    storedUploadPaths.push(...prepared.absolutePaths);
    const created = await createAdminLearningProgram(prepared.payload);
    createdProgramId = created.id;
  } catch (error) {
    if (createdProgramId) {
      try {
        await cleanupAdminLearningProgramCreateFailure(createdProgramId);
      } catch {
        // Preserve the original upload/persistence failure for callers.
      }
    } else {
      await cleanupStoredMediaFiles(storedUploadPaths);
    }
    Sentry.captureException(error);
    redirectWithError("/admin/learning-programs/new", getAdminActionErrorMessage(error));
  }

  redirect("/admin/learning-programs");
}

export async function updateLearningProgramAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = learningProgramSchema.safeParse({
    mainTitle: formData.get("mainTitle"),
    mainDescription: formData.get("mainDescription") ?? undefined,
    courseType: formData.get("courseType"),
    title: formData.get("title"),
    description1: formData.get("description1") ?? undefined,
    description2: formData.get("description2") ?? undefined,
    description3: formData.get("description3") ?? undefined,
    videoPromo: formData.get("videoPromo") ?? undefined,
    picture1: formData.get("picture1") ?? undefined,
    picture2: formData.get("picture2") ?? undefined,
    picture3: formData.get("picture3") ?? undefined,
  });

  if (!parsed.success) {
    redirectWithError(`/admin/learning-programs/${id}/edit`, "Please complete required learning program fields.");
  }

  try {
    await updateAdminLearningProgram(id, parsed.data);
    await persistLearningProgramImageUploads({
      formData,
      programId: id,
      payload: parsed.data,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(`/admin/learning-programs/${id}/edit`, getAdminActionErrorMessage(error));
  }

  redirect("/admin/learning-programs");
}

export async function createLearningVideoAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = learningVideoSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    shortDescription: formData.get("shortDescription") ?? undefined,
    category: formData.get("category"),
    categoryType: formData.get("categoryType") ?? undefined,
    categoryLevel: formData.get("categoryLevel") ?? undefined,
    thumbnail: formData.get("thumbnail") ?? undefined,
    videoUrl: formData.get("videoUrl") ?? undefined,
    priority: formData.get("priority"),
  });

  if (!parsed.success) {
    redirectWithError("/admin/learning-videos/new", "Please complete all required learning video fields.");
  }

  try {
    await createAdminLearningVideo(parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError("/admin/learning-videos/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/learning-videos");
}

export async function updateLearningVideoAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = learningVideoSchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    shortDescription: formData.get("shortDescription") ?? undefined,
    category: formData.get("category"),
    categoryType: formData.get("categoryType") ?? undefined,
    categoryLevel: formData.get("categoryLevel") ?? undefined,
    thumbnail: formData.get("thumbnail") ?? undefined,
    videoUrl: formData.get("videoUrl") ?? undefined,
    priority: formData.get("priority"),
  });

  if (!parsed.success) {
    redirectWithError(`/admin/learning-videos/${id}/edit`, "Please complete required learning video fields.");
  }

  try {
    await updateAdminLearningVideo(id, parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(`/admin/learning-videos/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/learning-videos");
}

export async function updateClientMessageStatusAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || "/admin/inbox";

  const parsed = updateClientMessageStatusSchema.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Invalid message status payload.");
  }

  try {
    await updateClientMessageStatus(parsed.data.id, parsed.data.status);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getPrismaErrorMessage(error));
  }

  redirect(returnTo);
}

export async function uploadAgendaPdfAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || "/admin/manage-site";

  const file = formData.get("agendaPdf");
  if (!(file instanceof File) || file.size < 1) {
    redirectWithError(returnTo, "Please select a PDF file.");
  }

  if (!file.type.includes("pdf")) {
    redirectWithError(returnTo, "Only PDF files are accepted.");
  }

  const bytes = await file.arrayBuffer();
  const uploadsDir = join(process.cwd(), "public", "uploads");
  const targetFileName = `agenda-${Date.now()}.pdf`;
  const targetAbsolutePath = join(uploadsDir, targetFileName);

  try {
    await mkdir(uploadsDir, { recursive: true });
    await writeFile(targetAbsolutePath, Buffer.from(bytes));
    await upsertActiveAgendaPdfDocument(`/uploads/${targetFileName}`);
  } catch (error) {
    Sentry.captureException(error);
    console.error("[admin/upload-agenda-pdf] failed", error);
    redirectWithError(returnTo, "Could not upload agenda PDF.");
  }

  redirect(returnTo);
}

export async function createSiteWeeklyScheduleEntryAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/manage-site";

  const parsed = siteWeeklyScheduleSchema.safeParse({
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    serviceId: formData.get("serviceId"),
    displayOrder: formData.get("displayOrder"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete all required static schedule fields.");
  }

  const repeatOn = toWeekdayArray(formData.getAll("repeatOn"));
  const targetDays = repeatOn.length > 0 ? repeatOn : [parsed.data.dayOfWeek];

  try {
    await Promise.all(
      targetDays.map((dayOfWeek) =>
        createAdminSiteWeeklyScheduleEntry({
          ...parsed.data,
          dayOfWeek,
        }),
      ),
    );
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  redirect(`${returnTo}?success=${encodeURIComponent("Weekly schedule row added.")}`);
}

export async function updateSiteWeeklyScheduleEntryAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/manage-site";
  const id = String(formData.get("id") ?? "").trim();

  const parsed = siteWeeklyScheduleSchema.safeParse({
    dayOfWeek: formData.get("dayOfWeek"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    serviceId: formData.get("serviceId"),
    displayOrder: formData.get("displayOrder"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!id || !parsed.success) {
    redirectWithError(returnTo, "Invalid static schedule update payload.");
  }

  try {
    await updateAdminSiteWeeklyScheduleEntry(id, parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  redirect(`${returnTo}?success=${encodeURIComponent("Weekly schedule row updated.")}`);
}

export async function deleteSiteWeeklyScheduleEntryAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/manage-site";
  const id = String(formData.get("id") ?? "").trim();

  if (!id) {
    redirectWithError(returnTo, "Invalid static schedule delete payload.");
  }

  try {
    await deleteAdminSiteWeeklyScheduleEntry(id);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  redirect(`${returnTo}?success=${encodeURIComponent("Weekly schedule row removed.")}`);
}

export async function updateCancellationPeriodAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/manage-site";

  const parsed = cancellationPeriodSchema.safeParse({
    cancellationPeriodHours: formData.get("cancellationPeriodHours"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Cancellation period must be a positive whole number of hours.");
  }

  try {
    await updateAdminCancellationPeriodHours(parsed.data.cancellationPeriodHours);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  redirect(`${returnTo}?success=${encodeURIComponent("Cancellation period updated.")}`);
}

export async function updateSiteTimeZoneAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/manage-site";

  const parsed = siteTimeZoneSchema.safeParse({
    timeZone: formData.get("timeZone"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Select a valid site timezone.");
  }

  try {
    await updateAdminSiteTimeZone(parsed.data.timeZone);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, "Select a valid site timezone.");
  }

  revalidatePath(returnTo);
  revalidatePath("/");
  revalidatePath("/kiosk");
  redirect(`${returnTo}?success=${encodeURIComponent("Site timezone updated.")}`);
}

export async function uploadTeacherImageAction(formData: FormData) {
  const session = await assertAdminAccess();
  const userId = String(formData.get("userId") ?? "").trim();
  const returnTo = userId ? `/admin/users/${userId}/edit` : "/admin/users";

  if (!userId) {
    redirectWithError(returnTo, "Teacher user id is required.");
  }

  const file = getOptionalImageFile(formData, "teacherImage");
  if (!file) {
    redirectWithError(returnTo, "Please select a teacher image file.");
  }

  try {
    await storeAdminImageWithPersistence({
      file,
      folder: "teachers",
      filenamePrefix: `teacher-${userId}`,
      persistPath: async (publicPath) => {
        await updateAdminTeacherImage({
          userId,
          imagePath: publicPath,
          adminUserId: session.user.id,
        });
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    console.error("[admin/upload-teacher-image] failed", error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Teacher picture updated.")}`);
}

export async function uploadClassImageAction(formData: FormData) {
  const session = await assertAdminAccess();
  const classTypeId = String(formData.get("classTypeId") ?? "").trim();
  const returnTo = classTypeId ? `/admin/classes/${classTypeId}/edit` : "/admin/classes";

  if (!classTypeId) {
    redirectWithError(returnTo, "Booking service id is required.");
  }

  const file = getOptionalImageFile(formData, "classImage");
  if (!file) {
    redirectWithError(returnTo, "Please select a service image file.");
  }

  try {
    await storeAdminImageWithPersistence({
      file,
      folder: "classes",
      filenamePrefix: `service-${classTypeId}`,
      persistPath: async (publicPath) => {
        await updateAdminClassImage({
          classTypeId,
          imagePath: publicPath,
          adminUserId: session.user.id,
        });
      },
    });
    clearPublicCatalogueCaches();
    revalidatePath("/admin/classes");
  } catch (error) {
    Sentry.captureException(error);
    console.error("[admin/upload-class-image] failed", error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Service image updated.")}`);
}

export async function saveMarketingCampaignFlowDraftAction(formData: FormData) {
  const session = await assertAdminAccess();
  const rawCampaignName = String(formData.get("campaignName") ?? "").trim();
  const rawSubject = String(formData.get("subject") ?? "").trim();
  const rawPreviewText = String(formData.get("previewText") ?? "").trim();
  const rawContentJson = String(formData.get("contentJson") ?? "").trim();
  const parsed = marketingCampaignFlowStep1Schema.safeParse({
    campaignId: String(formData.get("campaignId") ?? "").trim() || undefined,
    campaignName: rawCampaignName,
    subject: rawSubject,
    previewText: rawPreviewText,
    contentJson: rawContentJson,
  });

  if (!parsed.success) {
    const query = new URLSearchParams();
    if (rawCampaignName) {
      query.set("campaignName", rawCampaignName);
    }
    if (rawSubject) {
      query.set("subject", rawSubject);
    }
    if (rawPreviewText) {
      query.set("previewText", rawPreviewText);
    }
    redirectWithError(`/admin/marketing/campaigns/new${query.toString() ? `?${query.toString()}` : ""}`, getStep1ValidationErrorMessage(parsed.error));
  }

  let normalizedContentJson: ReturnType<typeof normalizeMarketingContentJson>;
  try {
    normalizedContentJson = normalizeMarketingContentJson(JSON.parse(parsed.data.contentJson));
  } catch {
    redirectWithError("/admin/marketing/campaigns/new", "Campaign content blocks are invalid.");
  }

  const {
    createMarketingCampaignFlowDraft,
    updateMarketingCampaignFlowDraft,
    getMarketingCampaignFlowDraftById,
  } = await import("@/lib/marketing/marketing-service");

  try {
    const actor = await resolveAdminActorUser({ actorUserId: session.user.id });

    let draft = parsed.data.campaignId
      ? await updateMarketingCampaignFlowDraft(parsed.data.campaignId, {
        name: parsed.data.campaignName,
        subject: parsed.data.subject,
        previewText: parsed.data.previewText,
        contentJson: normalizedContentJson,
        currentStep: "STEP_1",
      })
      : await createMarketingCampaignFlowDraft({
        createdById: actor.id,
        name: parsed.data.campaignName,
        goalPrompt: "",
        generatedDraft: {
          subject: parsed.data.subject,
          previewText: parsed.data.previewText,
          contentJson: normalizedContentJson,
        },
      });

    if (!draft) {
      throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
    }

    const file = formData.get("campaignImage");
    if (file instanceof File && file.size > 0) {
      const imageAssetUrl = await storeCampaignImageAsset(file, draft.id);
      draft = await updateMarketingCampaignFlowDraft(draft.id, {
        imageAssetUrl,
        currentStep: "STEP_1",
      });
    }

    const persistedDraft = draft ?? (await getMarketingCampaignFlowDraftById(parsed.data.campaignId ?? ""));
    if (!persistedDraft) {
      throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
    }

    redirect(
      `/admin/marketing/campaigns/new?campaignId=${persistedDraft.id}&success=${encodeURIComponent("Draft saved.")}`,
    );
  } catch (error) {
    if (isRedirectException(error)) {
      throw error;
    }
    Sentry.captureException(error);
    const fallback = new URLSearchParams();
    fallback.set("campaignName", parsed.data.campaignName);
    fallback.set("subject", parsed.data.subject);
    fallback.set("previewText", parsed.data.previewText);
    redirectWithError(`/admin/marketing/campaigns/new?${fallback.toString()}`, getMarketingActionErrorMessage(error));
  }
}

export async function generateMarketingCampaignFlowDraftAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  redirectWithError(
    campaignId ? `/admin/marketing/campaigns/new?campaignId=${encodeURIComponent(campaignId)}` : "/admin/marketing/campaigns/new",
    "AI draft generation is disabled. Use Save draft with content blocks.",
  );
}

export async function sendMarketingCampaignFlowTestEmailAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const rawToEmail = String(formData.get("toEmail") ?? "").trim().toLowerCase();
  const segmentIds = toStringArrayFromEntries(formData.getAll("segments"));
  const pageRaw = Number.parseInt(String(formData.get("page") ?? "1"), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  if (!campaignId) {
    redirectWithError("/admin/marketing/campaigns", "Save the campaign draft before sending a test email.");
  }

  const parsed = marketingCampaignTestSchema.safeParse({
    campaignId,
    toEmail: rawToEmail,
  });

  if (!parsed.success) {
    redirectWithError(
      buildMarketingFlowReviewHref({ campaignId, segmentIds, page, testEmail: rawToEmail }),
      "Enter a valid test email address.",
    );
  }

  const { sendMarketingCampaignFlowTestEmail } = await import("@/lib/marketing/marketing-service");
  try {
    await sendMarketingCampaignFlowTestEmail({
      campaignId: parsed.data.campaignId,
      toEmail: parsed.data.toEmail,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(
      buildMarketingFlowReviewHref({ campaignId: parsed.data.campaignId, segmentIds, page, testEmail: parsed.data.toEmail }),
      getMarketingActionErrorMessage(error),
    );
  }

  redirect(
    buildMarketingFlowReviewHref({
      campaignId: parsed.data.campaignId,
      segmentIds,
      page,
      testEmail: parsed.data.toEmail,
      success: "Test email sent.",
    }),
  );
}

export async function saveMarketingCampaignFlowParametersAction(formData: FormData) {
  await assertAdminAccess();
  const parsed = marketingCampaignFlowStep2Schema.safeParse({
    campaignId: formData.get("campaignId"),
    fromName: formData.get("fromName"),
    fromEmail: String(formData.get("fromEmail") ?? "").trim().toLowerCase(),
    replyTo: String(formData.get("replyTo") ?? "").trim().toLowerCase(),
    categoryId: String(formData.get("categoryId") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirectWithError("/admin/marketing/campaigns", "Please complete campaign parameters.");
  }

  const segmentIds = toStringArrayFromEntries(formData.getAll("segments"));
  const page = Number.parseInt(String(formData.get("page") ?? "1"), 10);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const { resolveMarketingCampaignFlowRecipients, updateMarketingCampaignFlowDraft } = await import("@/lib/marketing/marketing-service");
  let resolvedSelectedSegmentIds = segmentIds;

  try {
    const resolution = await resolveMarketingCampaignFlowRecipients({
      campaignId: parsed.data.campaignId,
      selectedSegmentIds: segmentIds,
      page: safePage,
    });
    resolvedSelectedSegmentIds = resolution.selectedSegmentIds;

    await updateMarketingCampaignFlowDraft(parsed.data.campaignId, {
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo || null,
      categoryId: parsed.data.categoryId ?? null,
      selectedSegmentIds: resolvedSelectedSegmentIds,
      currentStep: "STEP_3",
    });
  } catch (error) {
    Sentry.captureException(error);
    const query = new URLSearchParams();
    segmentIds.forEach((segmentId) => query.append("segments", segmentId));
    query.set("page", String(safePage));
    redirectWithError(
      `/admin/marketing/campaigns/${parsed.data.campaignId}/target${query.toString() ? `?${query.toString()}` : ""}`,
      getMarketingActionErrorMessage(error),
    );
  }

  const query = new URLSearchParams();
  resolvedSelectedSegmentIds.forEach((segmentId) => query.append("segments", segmentId));
  query.set("page", String(safePage));
  redirect(
    `/admin/marketing/campaigns/${parsed.data.campaignId}/review${query.toString() ? `?${query.toString()}` : ""}`,
  );
}

export async function moveMarketingCampaignFlowToConfirmAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  if (!campaignId) {
    redirectWithError("/admin/marketing/campaigns", "Campaign not found.");
  }

  const segmentIds = toStringArrayFromEntries(formData.getAll("segments"));
  const page = Number.parseInt(String(formData.get("page") ?? "1"), 10);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const { updateMarketingCampaignFlowDraft } = await import("@/lib/marketing/marketing-service");
  try {
    await updateMarketingCampaignFlowDraft(campaignId, { currentStep: "STEP_4" });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(`/admin/marketing/campaigns/${campaignId}/review`, getMarketingActionErrorMessage(error));
  }

  const query = new URLSearchParams();
  segmentIds.forEach((segmentId) => query.append("segments", segmentId));
  query.set("page", String(safePage));
  redirect(`/admin/marketing/campaigns/${campaignId}/confirm${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function markMarketingCampaignFlowSentAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  if (!campaignId) {
    redirectWithError("/admin/marketing/campaigns", "Campaign not found.");
  }

  const segmentIds = toStringArrayFromEntries(formData.getAll("segments"));
  const page = Number.parseInt(String(formData.get("page") ?? "1"), 10);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const { sendMarketingCampaignFlowNow } = await import("@/lib/marketing/marketing-service");
  try {
    await sendMarketingCampaignFlowNow({ campaignId });
  } catch (error) {
    Sentry.captureException(error);
    const query = new URLSearchParams();
    segmentIds.forEach((segmentId) => query.append("segments", segmentId));
    query.set("page", String(safePage));
    redirectWithError(
      `/admin/marketing/campaigns/${campaignId}/confirm${query.toString() ? `?${query.toString()}` : ""}`,
      getMarketingActionErrorMessage(error),
    );
  }

  const query = new URLSearchParams();
  segmentIds.forEach((segmentId) => query.append("segments", segmentId));
  query.set("page", String(safePage));
  redirect(`/admin/marketing/campaigns/${campaignId}/sent${query.toString() ? `?${query.toString()}` : ""}`);
}

export async function duplicateMarketingCampaignAction(formData: FormData) {
  const session = await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = "/admin/marketing/campaigns";
  const { duplicateMarketingCampaign } = await import("@/lib/marketing/marketing-service");

  const parsed = z.object({ campaignId: z.string().min(1) }).safeParse({ campaignId });
  if (!parsed.success) {
    redirectWithError(returnTo, "Campaign ID is required.");
  }

  try {
    const duplicated = await duplicateMarketingCampaign(parsed.data.campaignId, session.user.id);
    redirect(
      `/admin/marketing/campaigns/new?campaignId=${duplicated.id}&success=${encodeURIComponent("Campaign duplicated.")}`,
    );
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }
}

export async function deleteMarketingCampaignDraftAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = "/admin/marketing/campaigns";
  const { deleteMarketingCampaignDraft } = await import("@/lib/marketing/marketing-service");

  const parsed = z.object({ campaignId: z.string().min(1) }).safeParse({ campaignId });
  if (!parsed.success) {
    redirectWithError(returnTo, "Campaign ID is required.");
  }

  try {
    await deleteMarketingCampaignDraft(parsed.data.campaignId);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Draft deleted.")}`);
}

export async function createMarketingCategoryAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/marketing/categories";
  const { createMarketingCategory } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCategoryCreateSchema.safeParse({
    name: formData.get("name"),
    isActive: isChecked(formData, "isActive"),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Category name is required.");
  }

  try {
    await createMarketingCategory(parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Category created.")}`);
}

export async function updateMarketingCategoryAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/marketing/categories";
  const { updateMarketingCategory } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCategoryUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    isActive: isChecked(formData, "isActive"),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Invalid category payload.");
  }

  try {
    await updateMarketingCategory(parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Category updated.")}`);
}

export async function createMarketingSegmentAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/marketing/segments";
  const { createMarketingSegment } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingSegmentCreateSchema.safeParse({
    name: formData.get("name"),
    isActive: isChecked(formData, "isActive"),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Segment name is required.");
  }

  try {
    await createMarketingSegment(parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Segment created.")}`);
}

export async function updateMarketingSegmentAction(formData: FormData) {
  await assertAdminAccess();
  const returnTo = "/admin/marketing/segments";
  const { updateMarketingSegment } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingSegmentUpdateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    isActive: isChecked(formData, "isActive"),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Invalid segment payload.");
  }

  try {
    await updateMarketingSegment(parsed.data);
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Segment updated.")}`);
}

export async function bulkSetClientMarketingSubscriptionStatusAction(formData: FormData) {
  const session = await assertAdminAccess();
  const returnTo = "/admin/users";

  const parsed = bulkClientMarketingStatusSchema.safeParse({
    userIds: toStringArrayFromEntries(formData.getAll("userIds")),
    marketingSubscriptionStatus: String(formData.get("marketingSubscriptionStatus") ?? "").trim(),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Select CLIENT users and a subscription status.");
  }

  try {
    await bulkSetClientMarketingSubscriptionStatus({
      actorUserId: session.user.id,
      userIds: parsed.data.userIds,
      status: parsed.data.marketingSubscriptionStatus,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Marketing subscription status updated.")}`);
}

export async function bulkAddClientMarketingSegmentsAction(formData: FormData) {
  const session = await assertAdminAccess();
  const returnTo = "/admin/users";

  const parsed = bulkClientMarketingSegmentsSchema.safeParse({
    userIds: toStringArrayFromEntries(formData.getAll("userIds")),
    segmentIds: toStringArrayFromEntries(formData.getAll("segmentIds")),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Select CLIENT users and at least one segment.");
  }

  try {
    await bulkAddClientMarketingSegments({
      actorUserId: session.user.id,
      userIds: parsed.data.userIds,
      segmentIds: parsed.data.segmentIds,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Segments added to selected clients.")}`);
}

export async function bulkRemoveClientMarketingSegmentsAction(formData: FormData) {
  const session = await assertAdminAccess();
  const returnTo = "/admin/users";

  const parsed = bulkClientMarketingSegmentsSchema.safeParse({
    userIds: toStringArrayFromEntries(formData.getAll("userIds")),
    segmentIds: toStringArrayFromEntries(formData.getAll("segmentIds")),
  });
  if (!parsed.success) {
    redirectWithError(returnTo, "Select CLIENT users and at least one segment.");
  }

  try {
    await bulkRemoveClientMarketingSegments({
      actorUserId: session.user.id,
      userIds: parsed.data.userIds,
      segmentIds: parsed.data.segmentIds,
    });
  } catch (error) {
    Sentry.captureException(error);
    redirectWithError(returnTo, getAdminActionErrorMessage(error));
  }

  revalidatePath(returnTo);
  redirect(`${returnTo}?success=${encodeURIComponent("Segments removed from selected clients.")}`);
}



