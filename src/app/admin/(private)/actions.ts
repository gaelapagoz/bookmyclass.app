"use server";

import {
  BillingInterval,
  PaymentProvider,
  PriceType,
  ProductType,
  Role,
  StudioSessionStatus,
  SubscriptionStatus,
  Prisma,
} from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";

import { auth } from "@/auth";
import {
  createAdminClass,
  createAdminLearningProgram,
  createAdminLearningVideo,
  createAdminPlan,
  createAdminSession,
  createAdminSubscription,
  createAdminUser,
  updateAdminClass,
  updateAdminLearningProgram,
  updateAdminLearningVideo,
  updateAdminPlan,
  updateAdminSession,
  updateAdminSubscription,
  updateAdminUser,
} from "@/lib/admin/admin-service";
import { isAdminRole } from "@/lib/auth/admin-access";

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
  name: z.string().min(1),
  email: z.email(),
  role: z.nativeEnum(Role),
  isActive: z.boolean(),
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

async function assertAdminAccess(): Promise<void> {
  const session = await auth();

  if (!session?.user) {
    throw new Error("UNAUTHENTICATED");
  }

  if (!isAdminRole(session.user.role)) {
    throw new Error("FORBIDDEN");
  }
}

function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
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

  try {
    await createAdminClass(parsed.data);
  } catch (error) {
    redirectWithError("/admin/classes/new", getPrismaErrorMessage(error));
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

  try {
    await updateAdminClass(id, parsed.data);
  } catch (error) {
    redirectWithError(`/admin/classes/${id}/edit`, getPrismaErrorMessage(error));
  }

  redirect("/admin/classes");
}

export async function createSessionAction(formData: FormData) {
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
    redirectWithError("/admin/sessions/new", "Please complete all required session fields.");
  }

  try {
    await createAdminSession(parsed.data);
  } catch (error) {
    redirectWithError("/admin/sessions/new", getPrismaErrorMessage(error));
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
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
    isActive: isChecked(formData, "isActive"),
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





