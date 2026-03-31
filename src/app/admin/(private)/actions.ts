"use server";

import {
  BillingInterval,
  ClientMessageStatus,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  Weekday,
  Prisma,
} from "@prisma/client";
import { redirect } from "next/navigation";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Session } from "next-auth";
import type { MarketingAudienceType as MarketingAudienceTypeValue } from "@prisma/client";

import { auth } from "@/auth";
import {
  adjustAdminClientCredits,
  cancelAdminClientMembership,
  createAdminClass,
  createAdminLearningProgram,
  createAdminLearningVideo,
  createAdminPlan,
  createAdminSession,
  createAdminRecurringSessions,
  createAdminSubscription,
  createAdminUser,
  upsertAdminClassScheduleConfig,
  updateAdminClass,
  updateAdminLearningProgram,
  updateAdminLearningVideo,
  updateAdminPlan,
  updateAdminSession,
  updateAdminSubscription,
  updateAdminUser,
} from "@/lib/admin/admin-service";
import { isAdminRole } from "@/lib/auth/admin-access";
import { upsertActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";
import { updateClientMessageStatus } from "@/lib/client-messages/client-message-service";
import { normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";

const classSchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  defaultDurationMinutes: z.coerce.number().int().positive(),
  defaultCapacity: z.coerce.number().int().positive(),
  isActive: z.boolean(),
  isVisible: z.boolean(),
  sortOrder: z.coerce.number().int().min(0),
});

const classScheduleSchema = z
  .object({
    defaultTeacherId: z.string().min(1),
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    isRecurring: z.boolean(),
    date: z.date().nullable().optional(),
    repeatEveryWeeks: z.coerce.number().int().min(1).max(12).optional(),
    weekdays: z.array(z.nativeEnum(Weekday)).optional(),
    endsType: z.enum(["never", "onDate", "afterOccurrences"]).optional(),
    endDate: z.date().nullable().optional(),
    occurrenceCount: z.number().int().min(1).max(260).nullable().optional(),
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

    const endsType = input.endsType ?? "never";
    if (input.isRecurring && endsType === "onDate" && !input.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date is required.",
        path: ["endDate"],
      });
    }
    if (input.isRecurring && endsType === "afterOccurrences" && !input.occurrenceCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Occurrence count is required.",
        path: ["occurrenceCount"],
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

const planSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    productType: z.nativeEnum(ProductType),
    isActive: z.boolean(),
    sortOrder: z.coerce.number().int().min(0),
    priceName: z.string().optional(),
    priceType: z.nativeEnum(PriceType),
    currencyCode: z.string().length(3),
    unitAmount: z.coerce.number().positive(),
    billingInterval: z.nativeEnum(BillingInterval).optional(),
    billingIntervalCount: z.coerce.number().int().positive().optional(),
  })
  .refine((input) => input.priceType === PriceType.ONE_TIME || Boolean(input.billingInterval), {
    message: "Billing interval is required for recurring prices.",
    path: ["billingInterval"],
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
  legacyId: z.string().min(1),
  mainTitle: z.string().min(1),
  mainDescription: z.string().optional(),
  courseType: z.string().min(1),
  title: z.string().min(1),
  description1: z.string().optional(),
  description2: z.string().optional(),
  description3: z.string().optional(),
  videoPromo: z.string().optional(),
  picture1: z.string().optional(),
  picture2: z.string().optional(),
  picture3: z.string().optional(),
});

const learningVideoSchema = z.object({
  legacyId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  category: z.string().min(1),
  categoryType: z.string().optional(),
  categoryLevel: z.string().optional(),
  thumbnail: z.string().optional(),
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

const marketingAudienceTypeSchema = z.enum([
  "ALL_USERS",
  "ACTIVE_USERS",
  "PAYING_SUBSCRIBERS",
  "MANUAL",
]);

const marketingCampaignDraftSchema = z.object({
  campaignId: z.string().min(1).optional(),
  name: z.string().min(1),
  categoryId: z.string().optional(),
  audienceType: marketingAudienceTypeSchema,
  manualAudienceJson: z.string().optional(),
  subject: z.string().min(1),
  previewText: z.string().min(1),
  fromName: z.string().min(1),
  fromEmail: z.email(),
  replyTo: z.union([z.email(), z.literal("")]).optional(),
  contentJson: z.string().min(1),
});

const marketingAiDraftSchema = z.object({
  campaignId: z.string().min(1),
  goal: z.string().min(5).max(400),
  audience: z.string().min(2).max(200),
  tone: z.string().min(2).max(100),
  cta: z.string().min(2).max(200),
  extraContext: z.string().max(2000).optional(),
});

const marketingCampaignTestSchema = z.object({
  campaignId: z.string().min(1),
  toEmail: z.email(),
});

const marketingCampaignNowSchema = z.object({
  campaignId: z.string().min(1),
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
  if (code === "SUBSCRIPTION_NOT_FOUND") {
    return "Selected membership could not be found for this user.";
  }
  if (code === "CLIENT_NOT_FOUND") {
    return "Client account was not found. Refresh the page and try again.";
  }
  if (code === "ADMIN_USER_NOT_FOUND") {
    return "Your admin session is no longer valid. Sign in again and retry.";
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

  return getPrismaErrorMessage(error);
}

type AdminSession = Session & {
  user: NonNullable<Session["user"]> & {
    id: string;
    role: Role;
  };
};

async function assertAdminAccess(): Promise<AdminSession> {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  const role = session.user.role;
  if (!role || !isAdminRole(role)) {
    throw new Error("FORBIDDEN");
  }

  if (!session.user.id) {
    throw new Error("UNAUTHENTICATED");
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: session.user.id,
      role,
    },
  };
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

function toStringArray(value: FormDataEntryValue | null): string[] {
  const raw = String(value ?? "");
  return raw
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMarketingManualAudienceJson(value: string | undefined): Prisma.JsonValue {
  if (!value?.trim()) {
    return { emails: [], userIds: [] };
  }

  try {
    const parsed = JSON.parse(value) as { emails?: unknown; userIds?: unknown };
    const emails = Array.isArray(parsed.emails)
      ? parsed.emails.map((item) => String(item).trim().toLowerCase()).filter(Boolean)
      : [];
    const userIds = Array.isArray(parsed.userIds) ? parsed.userIds.map((item) => String(item).trim()).filter(Boolean) : [];
    return {
      emails: [...new Set(emails)],
      userIds: [...new Set(userIds)],
    };
  } catch {
    return { emails: [], userIds: [] };
  }
}

function getMarketingActionErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";

  if (code === "MARKETING_CAMPAIGN_NOT_FOUND") {
    return "Campaign not found.";
  }
  if (code === "MARKETING_CAMPAIGN_NOT_DRAFT") {
    return "Only draft campaigns can be changed or sent.";
  }
  if (code === "OPENAI_API_KEY_MISSING") {
    return "AI Assist is not configured. Missing OPENAI_API_KEY.";
  }
  if (code === "MARKETING_AI_GENERATION_FAILED") {
    return "AI draft generation failed. Try again in a moment.";
  }
  if (code === "MARKETING_AI_EMPTY_OUTPUT" || code === "MARKETING_AI_INVALID_JSON" || code === "MARKETING_AI_SCHEMA_INVALID") {
    return "AI returned an invalid draft. Please retry with clearer inputs.";
  }
  if (code === "MARKETING_TEST_SEND_FAILED") {
    return "Test email failed to send.";
  }

  return getPrismaErrorMessage(error);
}

export async function createClassAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = classSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
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
    repeatEveryWeeks: formData.get("repeatEveryWeeks") || undefined,
    weekdays: formData
      .getAll("repeatWeekdays")
      .map((value) => String(value).trim())
      .filter(Boolean),
    endsType: formData.get("endsType") || undefined,
    endDate: toNullableDate(formData.get("endDate")),
    occurrenceCount: (() => {
      const raw = String(formData.get("occurrenceCount") ?? "").trim();
      return raw ? Number.parseInt(raw, 10) : null;
    })(),
  });

  if (!scheduleParsed.success) {
    redirectWithError("/admin/classes/new", "Please complete all required class schedule fields.");
  }

  try {
    const createdClass = await createAdminClass(parsed.data);
    await upsertAdminClassScheduleConfig({
      classTypeId: createdClass.id,
      className: createdClass.name,
      classSlug: createdClass.slug,
      defaultCapacity: createdClass.defaultCapacity,
      defaultDurationMinutes: createdClass.defaultDurationMinutes,
      defaultTeacherId: scheduleParsed.data.defaultTeacherId,
      startTime: scheduleParsed.data.startTime,
      endTime: scheduleParsed.data.endTime,
      isRecurring: scheduleParsed.data.isRecurring,
      date: scheduleParsed.data.date ?? null,
      repeatEveryWeeks: scheduleParsed.data.repeatEveryWeeks ?? 1,
      weekdays: scheduleParsed.data.weekdays ?? [],
      endsType: scheduleParsed.data.endsType ?? "never",
      endDate: scheduleParsed.data.endDate ?? null,
      occurrenceCount: scheduleParsed.data.occurrenceCount ?? null,
    });
  } catch (error) {
    redirectWithError("/admin/classes/new", getAdminActionErrorMessage(error));
  }

  redirect("/admin/classes");
}

export async function updateClassAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = classSchema.safeParse({
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    slug: formData.get("slug"),
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
    repeatEveryWeeks: formData.get("repeatEveryWeeks") || undefined,
    weekdays: formData
      .getAll("repeatWeekdays")
      .map((value) => String(value).trim())
      .filter(Boolean),
    endsType: formData.get("endsType") || undefined,
    endDate: toNullableDate(formData.get("endDate")),
    occurrenceCount: (() => {
      const raw = String(formData.get("occurrenceCount") ?? "").trim();
      return raw ? Number.parseInt(raw, 10) : null;
    })(),
  });

  if (!scheduleParsed.success) {
    redirectWithError(`/admin/classes/${id}/edit`, "Please complete all required class schedule fields.");
  }

  try {
    const updatedClass = await updateAdminClass(id, parsed.data);
    await upsertAdminClassScheduleConfig({
      classTypeId: updatedClass.id,
      className: updatedClass.name,
      classSlug: updatedClass.slug,
      defaultCapacity: updatedClass.defaultCapacity,
      defaultDurationMinutes: updatedClass.defaultDurationMinutes,
      defaultTeacherId: scheduleParsed.data.defaultTeacherId,
      startTime: scheduleParsed.data.startTime,
      endTime: scheduleParsed.data.endTime,
      isRecurring: scheduleParsed.data.isRecurring,
      date: scheduleParsed.data.date ?? null,
      repeatEveryWeeks: scheduleParsed.data.repeatEveryWeeks ?? 1,
      weekdays: scheduleParsed.data.weekdays ?? [],
      endsType: scheduleParsed.data.endsType ?? "never",
      endDate: scheduleParsed.data.endDate ?? null,
      occurrenceCount: scheduleParsed.data.occurrenceCount ?? null,
    });
  } catch (error) {
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
    redirectWithError("/admin/sessions/new", getAdminActionErrorMessage(error));
  }

  redirect("/admin/sessions");
}

export async function updateSessionAction(id: string, formData: FormData) {
  await assertAdminAccess();

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
    redirectWithError(`/admin/sessions/${id}/edit`, "Please complete all required session fields.");
  }

  try {
    await updateAdminSession(id, parsed.data);
  } catch (error) {
    redirectWithError(`/admin/sessions/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/sessions");
}

export async function createPlanAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    productType: formData.get("productType"),
    isActive: isChecked(formData, "isActive"),
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    priceType: formData.get("priceType"),
    currencyCode: String(formData.get("currencyCode") ?? "").toUpperCase(),
    unitAmount: formData.get("unitAmount"),
    billingInterval: formData.get("billingInterval") || undefined,
    billingIntervalCount: formData.get("billingIntervalCount") || undefined,
  });

  if (!parsed.success) {
    redirectWithError("/admin/plans/new", "Please complete all required plan fields.");
  }

  try {
    await createAdminPlan({
      name: parsed.data.name,
      description: parsed.data.description,
      productType: parsed.data.productType,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      priceType: parsed.data.priceType,
      currencyCode: parsed.data.currencyCode,
      unitAmountMinor: Math.round(parsed.data.unitAmount * 100),
      billingInterval: parsed.data.priceType === PriceType.RECURRING ? parsed.data.billingInterval : undefined,
      billingIntervalCount: parsed.data.priceType === PriceType.RECURRING ? parsed.data.billingIntervalCount ?? 1 : undefined,
    });
  } catch (error) {
    redirectWithError("/admin/plans/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/plans");
}

export async function updatePlanAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = planSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    productType: formData.get("productType"),
    isActive: isChecked(formData, "isActive"),
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    priceType: formData.get("priceType"),
    currencyCode: String(formData.get("currencyCode") ?? "").toUpperCase(),
    unitAmount: formData.get("unitAmount"),
    billingInterval: formData.get("billingInterval") || undefined,
    billingIntervalCount: formData.get("billingIntervalCount") || undefined,
  });

  if (!parsed.success) {
    redirectWithError(`/admin/plans/${id}/edit`, "Please complete all required plan fields.");
  }

  try {
    await updateAdminPlan(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      productType: parsed.data.productType,
      isActive: parsed.data.isActive,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      priceType: parsed.data.priceType,
      currencyCode: parsed.data.currencyCode,
      unitAmountMinor: Math.round(parsed.data.unitAmount * 100),
      billingInterval: parsed.data.priceType === PriceType.RECURRING ? parsed.data.billingInterval : undefined,
      billingIntervalCount: parsed.data.priceType === PriceType.RECURRING ? parsed.data.billingIntervalCount ?? 1 : undefined,
    });
  } catch (error) {
    redirectWithError(`/admin/plans/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/plans");
}

export async function createUserAction(formData: FormData) {
  await assertAdminAccess();

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

  try {
    await createAdminUser(parsed.data);
  } catch (error) {
    redirectWithError("/admin/users/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/users");
}

export async function updateUserAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = updateUserSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    role: formData.get("role"),
    isActive: isChecked(formData, "isActive"),
    phone: formData.get("phone") ?? undefined,
    notes: formData.get("notes") ?? undefined,
    bio: formData.get("bio") ?? undefined,
    specialties: toStringArray(formData.get("specialties")),
    certifications: toStringArray(formData.get("certifications")),
    hireDate: toNullableDate(formData.get("hireDate")),
    password: formData.get("password") || undefined,
  });

  if (!parsed.success) {
    redirectWithError(`/admin/users/${id}/edit`, "Please complete required user fields.");
  }

  try {
    await updateAdminUser(id, parsed.data);
  } catch (error) {
    redirectWithError(`/admin/users/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/users");
}

export async function adjustClientCreditsAction(formData: FormData) {
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
      adminUserId: session.user.id,
    });
  } catch (error) {
    console.error("[admin/adjust-client-credits] service_failed", {
      userId: parsed.data.userId,
      entitlementId: parsed.data.entitlementId ?? null,
      productId: parsed.data.productId ?? null,
      creditDelta: parsed.data.creditDelta,
      expiresAt: parsed.data.expiresAt?.toISOString() ?? null,
      adminUserId: session.user.id,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : String(error),
    });
    redirectWithError(returnPath, getAdminActionErrorMessage(error));
  }

  redirect(returnPath);
}

export async function cancelClientMembershipAction(formData: FormData) {
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
    redirectWithError(returnPath, getAdminActionErrorMessage(error));
  }

  redirect(returnPath);
}

export async function createSubscriptionAction(formData: FormData) {
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
    redirectWithError("/admin/subscriptions/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/subscriptions");
}

export async function updateSubscriptionAction(id: string, formData: FormData) {
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
    redirectWithError(`/admin/subscriptions/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/subscriptions");
}

export async function createLearningProgramAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = learningProgramSchema.safeParse({
    legacyId: formData.get("legacyId"),
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

  try {
    await createAdminLearningProgram(parsed.data);
  } catch (error) {
    redirectWithError("/admin/learning-programs/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/learning-programs");
}

export async function updateLearningProgramAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = learningProgramSchema.safeParse({
    legacyId: formData.get("legacyId"),
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
  } catch (error) {
    redirectWithError(`/admin/learning-programs/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/learning-programs");
}

export async function createLearningVideoAction(formData: FormData) {
  await assertAdminAccess();

  const parsed = learningVideoSchema.safeParse({
    legacyId: formData.get("legacyId"),
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
    redirectWithError("/admin/learning-videos/new", getPrismaErrorMessage(error));
  }

  redirect("/admin/learning-videos");
}

export async function updateLearningVideoAction(id: string, formData: FormData) {
  await assertAdminAccess();

  const parsed = learningVideoSchema.safeParse({
    legacyId: formData.get("legacyId"),
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
    console.error("[admin/upload-agenda-pdf] failed", error);
    redirectWithError(returnTo, "Could not upload agenda PDF.");
  }

  redirect(returnTo);
}

export async function createMarketingCampaignDraftAction(formData: FormData) {
  const session = await assertAdminAccess();
  const returnTo = "/admin/marketing/campaigns/new";
  const { createMarketingCampaignDraft } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCampaignDraftSchema.safeParse({
    name: formData.get("name"),
    categoryId: String(formData.get("categoryId") ?? "").trim() || undefined,
    audienceType: formData.get("audienceType"),
    manualAudienceJson: String(formData.get("manualAudienceJson") ?? "").trim() || undefined,
    subject: formData.get("subject"),
    previewText: formData.get("previewText"),
    fromName: formData.get("fromName"),
    fromEmail: String(formData.get("fromEmail") ?? "").trim().toLowerCase(),
    replyTo: String(formData.get("replyTo") ?? "").trim().toLowerCase(),
    contentJson: formData.get("contentJson"),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete all required campaign fields.");
  }

  let contentJson: unknown;
  try {
    contentJson = JSON.parse(parsed.data.contentJson);
    normalizeMarketingContentJson(contentJson);
  } catch {
    redirectWithError(returnTo, "Campaign content is invalid.");
  }

  try {
    const created = await createMarketingCampaignDraft({
      name: parsed.data.name,
      categoryId: parsed.data.categoryId ?? null,
      audienceType: parsed.data.audienceType as MarketingAudienceTypeValue,
      manualAudienceJson: parseMarketingManualAudienceJson(parsed.data.manualAudienceJson),
      subject: parsed.data.subject,
      previewText: parsed.data.previewText,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo || null,
      contentJson,
      createdById: session.user.id,
    });
    redirect(`/admin/marketing/campaigns/${created.id}/edit?success=${encodeURIComponent("Draft created.")}`);
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }
}

export async function updateMarketingCampaignDraftAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = campaignId ? `/admin/marketing/campaigns/${campaignId}/edit` : "/admin/marketing/campaigns";
  const { updateMarketingCampaignDraft } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCampaignDraftSchema.safeParse({
    campaignId,
    name: formData.get("name"),
    categoryId: String(formData.get("categoryId") ?? "").trim() || undefined,
    audienceType: formData.get("audienceType"),
    manualAudienceJson: String(formData.get("manualAudienceJson") ?? "").trim() || undefined,
    subject: formData.get("subject"),
    previewText: formData.get("previewText"),
    fromName: formData.get("fromName"),
    fromEmail: String(formData.get("fromEmail") ?? "").trim().toLowerCase(),
    replyTo: String(formData.get("replyTo") ?? "").trim().toLowerCase(),
    contentJson: formData.get("contentJson"),
  });

  if (!parsed.success || !parsed.data.campaignId) {
    redirectWithError(returnTo, "Invalid campaign payload.");
  }

  let contentJson: unknown;
  try {
    contentJson = JSON.parse(parsed.data.contentJson);
    normalizeMarketingContentJson(contentJson);
  } catch {
    redirectWithError(returnTo, "Campaign content is invalid.");
  }

  try {
    await updateMarketingCampaignDraft(parsed.data.campaignId, {
      name: parsed.data.name,
      categoryId: parsed.data.categoryId ?? null,
      audienceType: parsed.data.audienceType as MarketingAudienceTypeValue,
      manualAudienceJson: parseMarketingManualAudienceJson(parsed.data.manualAudienceJson),
      subject: parsed.data.subject,
      previewText: parsed.data.previewText,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo || null,
      contentJson,
    });
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Draft updated.")}`);
}

export async function generateMarketingCampaignAiDraftAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = campaignId ? `/admin/marketing/campaigns/${campaignId}/edit` : "/admin/marketing/campaigns";
  const { getMarketingCampaignById, updateMarketingCampaignDraft } = await import("@/lib/marketing/marketing-service");
  const { generateMarketingAiDraft } = await import("@/lib/marketing/marketing-ai");

  const parsed = marketingAiDraftSchema.safeParse({
    campaignId,
    goal: formData.get("goal"),
    audience: formData.get("audience"),
    tone: formData.get("tone"),
    cta: formData.get("cta"),
    extraContext: formData.get("extraContext") ?? undefined,
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Please complete all AI Assist fields.");
  }

  try {
    const campaign = await getMarketingCampaignById(parsed.data.campaignId);
    if (!campaign) {
      throw new Error("MARKETING_CAMPAIGN_NOT_FOUND");
    }

    const draft = await generateMarketingAiDraft({
      goal: parsed.data.goal,
      audience: parsed.data.audience,
      tone: parsed.data.tone,
      cta: parsed.data.cta,
      extraContext: parsed.data.extraContext,
    });

    await updateMarketingCampaignDraft(parsed.data.campaignId, {
      name: campaign.name,
      categoryId: campaign.categoryId,
      audienceType: campaign.audienceType,
      manualAudienceJson: campaign.manualAudienceJson,
      fromName: campaign.fromName,
      fromEmail: campaign.fromEmail,
      replyTo: campaign.replyTo,
      subject: draft.subject,
      previewText: draft.previewText,
      contentJson: draft.contentJson,
    });
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("AI draft generated.")}`);
}

export async function sendMarketingCampaignTestAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = campaignId ? `/admin/marketing/campaigns/${campaignId}/edit` : "/admin/marketing/campaigns";
  const { sendMarketingCampaignTest } = await import("@/lib/marketing/marketing-delivery");

  const parsed = marketingCampaignTestSchema.safeParse({
    campaignId,
    toEmail: String(formData.get("toEmail") ?? "").trim().toLowerCase(),
  });

  if (!parsed.success) {
    redirectWithError(returnTo, "Enter a valid test recipient email.");
  }

  try {
    await sendMarketingCampaignTest(parsed.data);
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Test email sent.")}`);
}

export async function sendMarketingCampaignNowAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = campaignId ? `/admin/marketing/campaigns/${campaignId}/edit` : "/admin/marketing/campaigns";
  const { sendMarketingCampaignNow } = await import("@/lib/marketing/marketing-delivery");

  const parsed = marketingCampaignNowSchema.safeParse({ campaignId });
  if (!parsed.success) {
    redirectWithError(returnTo, "Invalid send payload.");
  }

  try {
    await sendMarketingCampaignNow(parsed.data.campaignId);
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`/admin/marketing/campaigns?status=sent&success=${encodeURIComponent("Campaign sent.")}`);
}

export async function duplicateMarketingCampaignAction(formData: FormData) {
  const session = await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = "/admin/marketing/campaigns";
  const { duplicateMarketingCampaign } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCampaignNowSchema.safeParse({ campaignId });
  if (!parsed.success) {
    redirectWithError(returnTo, "Campaign ID is required.");
  }

  try {
    const duplicated = await duplicateMarketingCampaign(parsed.data.campaignId, session.user.id);
    redirect(`/admin/marketing/campaigns/${duplicated.id}/edit?success=${encodeURIComponent("Campaign duplicated.")}`);
  } catch (error) {
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }
}

export async function deleteMarketingCampaignDraftAction(formData: FormData) {
  await assertAdminAccess();
  const campaignId = String(formData.get("campaignId") ?? "").trim();
  const returnTo = "/admin/marketing/campaigns";
  const { deleteMarketingCampaignDraft } = await import("@/lib/marketing/marketing-service");

  const parsed = marketingCampaignNowSchema.safeParse({ campaignId });
  if (!parsed.success) {
    redirectWithError(returnTo, "Campaign ID is required.");
  }

  try {
    await deleteMarketingCampaignDraft(parsed.data.campaignId);
  } catch (error) {
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
    redirectWithError(returnTo, getMarketingActionErrorMessage(error));
  }

  redirect(`${returnTo}?success=${encodeURIComponent("Category updated.")}`);
}

