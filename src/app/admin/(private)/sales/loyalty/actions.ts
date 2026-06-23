"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  grantManualLoyaltyPointsByAdmin,
  resolveAdminLoyaltyClientIdByEmail,
  upsertLoyaltyProgramSettingsByAdmin,
} from "@/lib/loyalty/loyalty-admin-service";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";

const loyaltyProgramActionSchema = z.object({
  currencyCode: z.string().trim().length(3),
  isActive: z.boolean(),
  earningPoints: z.coerce.number().int().positive(),
  earningAmountDisplay: z.string().trim().min(1),
  pointsExpireAfterDays: z.coerce.number().int().positive(),
  expirationReminderDays: z.string().trim().optional(),
  maxManualGrantPoints: z.coerce.number().int().positive(),
  rewardName: z.string().trim().min(1).max(120).optional(),
  rewardPointsRequired: z.coerce.number().int().positive().optional(),
  rewardAmountDisplay: z.string().trim().optional(),
  eligibleProductIds: z.array(z.string().trim().min(1)).max(250),
  clientId: z.string().trim().optional(),
  query: z.string().trim().optional(),
  page: z.string().trim().optional(),
});

const loyaltyManualGrantSchema = z.object({
  currencyCode: z.string().trim().length(3),
  clientEmail: z.string().trim().email(),
  amountPoints: z.coerce.number().int().positive(),
  reason: z.string().trim().min(10).max(500),
  grantRequestKey: z.string().trim().min(1).max(200),
  query: z.string().trim().optional(),
  page: z.string().trim().optional(),
});

function toMinorAmount(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) {
    return null;
  }

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount * 100);
}

function toOptionalPositiveInt(value: string | undefined): number | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildSalesLoyaltyPageHref(input: {
  currencyCode: string;
  clientId?: string;
  query?: string;
  page?: string;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  params.set("currencyCode", input.currencyCode.trim().toUpperCase());

  if (input.clientId) {
    params.set("clientId", input.clientId);
  }

  if (input.query) {
    params.set("q", input.query);
  }

  if (input.page) {
    params.set("page", input.page);
  }

  if (input.error) {
    params.set("error", input.error);
  }

  if (input.success) {
    params.set("success", input.success);
  }

  return `/admin/sales/loyalty?${params.toString()}`;
}

function buildCatalogLoyaltyPageHref(input: {
  currencyCode: string;
  error?: string;
  success?: string;
}) {
  const params = new URLSearchParams();
  params.set("currencyCode", input.currencyCode.trim().toUpperCase());

  if (input.error) {
    params.set("error", input.error);
  }

  if (input.success) {
    params.set("success", input.success);
  }

  return `/admin/catalog/loyalty?${params.toString()}`;
}

function getErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return error instanceof Error ? error.message : "UNKNOWN";
}

function mapProgramActionError(error: unknown) {
  switch (getErrorCode(error)) {
    case "LOYALTY_PROGRAM_INPUT_INVALID":
      return "Loyalty program settings are invalid.";
    case "LOYALTY_ELIGIBLE_PRODUCTS_INVALID":
      return "Eligible products must have an active one-time price in this currency.";
    default:
      return "Unable to save loyalty program settings right now.";
  }
}

function mapManualGrantActionError(error: unknown) {
  switch (getErrorCode(error)) {
    case "LOYALTY_ADMIN_FORBIDDEN":
    case "LOYALTY_ADMIN_REQUIRED":
      return "Admin access is required for loyalty manual grants.";
    case "LOYALTY_CLIENT_REQUIRED":
      return "Select a valid client before granting loyalty points.";
    case "LOYALTY_CLIENT_NOT_ACTIVE":
      return "Inactive clients cannot receive loyalty points.";
    case "LOYALTY_CLIENT_EMAIL_UNVERIFIED":
      return "Verified clients are required for loyalty manual grants.";
    case "LOYALTY_PROGRAM_NOT_FOUND":
    case "LOYALTY_PROGRAM_NOT_ACTIVE":
      return "An active loyalty program is required before granting points.";
    case "LOYALTY_PROGRAM_INPUT_INVALID":
    case "LOYALTY_MANUAL_GRANT_INVALID":
      return "Manual grant details are invalid.";
    default:
      if (error instanceof Error && error.message.includes("configured maximum")) {
        return "Manual grant exceeds the configured maximum.";
      }
      return "Unable to grant loyalty points right now.";
  }
}

async function assertAdminAccess() {
  await assertSameOriginServerAction();
  return requireAdminSession();
}

export async function saveLoyaltyProgramAction(formData: FormData) {
  const session = await assertAdminAccess();
  const parsed = loyaltyProgramActionSchema.safeParse({
    currencyCode: String(formData.get("currencyCode") ?? "").trim().toUpperCase(),
    isActive: formData.get("isActive") === "on",
    earningPoints: formData.get("earningPoints"),
    earningAmountDisplay: String(formData.get("earningAmountDisplay") ?? ""),
    pointsExpireAfterDays: formData.get("pointsExpireAfterDays"),
    expirationReminderDays: String(formData.get("expirationReminderDays") ?? ""),
    maxManualGrantPoints: formData.get("maxManualGrantPoints"),
    rewardName: String(formData.get("rewardName") ?? "").trim() || undefined,
    rewardPointsRequired: formData.get("rewardPointsRequired") || undefined,
    rewardAmountDisplay: String(formData.get("rewardAmountDisplay") ?? "").trim() || undefined,
    eligibleProductIds: formData.getAll("eligibleProductIds").map((value) => String(value)),
    clientId: String(formData.get("clientId") ?? "").trim() || undefined,
    query: String(formData.get("query") ?? "").trim() || undefined,
    page: String(formData.get("page") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect(buildCatalogLoyaltyPageHref({
      currencyCode: String(formData.get("currencyCode") ?? "EUR"),
      error: "Invalid loyalty program input.",
    }));
  }

  const earningAmountMinor = toMinorAmount(parsed.data.earningAmountDisplay);
  const rewardAmountMinor = toMinorAmount(parsed.data.rewardAmountDisplay ?? "5.00");
  const expirationReminderDays = toOptionalPositiveInt(parsed.data.expirationReminderDays);
  if (earningAmountMinor === null) {
    redirect(buildCatalogLoyaltyPageHref({
      currencyCode: parsed.data.currencyCode,
      error: "Spend threshold must be a positive amount.",
    }));
  }
  if (rewardAmountMinor === null) {
    redirect(buildCatalogLoyaltyPageHref({
      currencyCode: parsed.data.currencyCode,
      error: "Reward amount must be a positive amount.",
    }));
  }

  try {
    await upsertLoyaltyProgramSettingsByAdmin({
      actorUserId: session.user.id,
      currencyCode: parsed.data.currencyCode,
      isActive: parsed.data.isActive,
      earningPoints: parsed.data.earningPoints,
      earningAmountMinor,
      pointsExpireAfterDays: parsed.data.pointsExpireAfterDays,
      expirationReminderDays,
      maxManualGrantPoints: parsed.data.maxManualGrantPoints,
      rewardName: parsed.data.rewardName ?? "5 EURO Reward",
      rewardPointsRequired: parsed.data.rewardPointsRequired ?? 500,
      rewardAmountMinor,
      eligibleProductIds: parsed.data.eligibleProductIds,
    });
  } catch (error) {
    redirect(buildCatalogLoyaltyPageHref({
      currencyCode: parsed.data.currencyCode,
      error: mapProgramActionError(error),
    }));
  }

  revalidatePath("/admin/sales/loyalty");
  revalidatePath("/admin/catalog/loyalty");
  redirect(buildCatalogLoyaltyPageHref({
    currencyCode: parsed.data.currencyCode,
    success: "Loyalty program updated.",
  }));
}

export async function grantLoyaltyPointsAction(formData: FormData) {
  const session = await assertAdminAccess();
  const parsed = loyaltyManualGrantSchema.safeParse({
    currencyCode: String(formData.get("currencyCode") ?? "").trim().toUpperCase(),
    clientEmail: String(formData.get("clientEmail") ?? "").trim(),
    amountPoints: formData.get("amountPoints"),
    reason: String(formData.get("reason") ?? ""),
    grantRequestKey: String(formData.get("grantRequestKey") ?? "").trim(),
    query: String(formData.get("query") ?? "").trim() || undefined,
    page: String(formData.get("page") ?? "").trim() || undefined,
  });

  if (!parsed.success) {
    redirect(buildSalesLoyaltyPageHref({
      currencyCode: String(formData.get("currencyCode") ?? "EUR"),
      query: String(formData.get("query") ?? "").trim() || undefined,
      page: String(formData.get("page") ?? "").trim() || undefined,
      error: "Invalid loyalty manual grant input.",
    }));
  }

  let clientId: string;
  try {
    const resolvedClient = await resolveAdminLoyaltyClientIdByEmail({
      actorUserId: session.user.id,
      email: parsed.data.clientEmail,
    });
    clientId = resolvedClient.id;
  } catch (error) {
    redirect(buildSalesLoyaltyPageHref({
      currencyCode: parsed.data.currencyCode,
      query: String(formData.get("query") ?? "").trim() || undefined,
      page: String(formData.get("page") ?? "").trim() || undefined,
      error: mapManualGrantActionError(error),
    }));
  }

  try {
    await grantManualLoyaltyPointsByAdmin({
      actorUserId: session.user.id,
      clientId,
      currencyCode: parsed.data.currencyCode,
      amountPoints: parsed.data.amountPoints,
      reason: parsed.data.reason,
      idempotencyKey: `loyalty:manual-grant:admin-action:${session.user.id}:${clientId}:${parsed.data.grantRequestKey}`,
      metadata: {
        source: "admin-sales-loyalty-page",
        clientEmail: parsed.data.clientEmail,
      },
    });
  } catch (error) {
    redirect(buildSalesLoyaltyPageHref({
      currencyCode: parsed.data.currencyCode,
      query: parsed.data.query,
      page: parsed.data.page,
      error: mapManualGrantActionError(error),
    }));
  }

  revalidatePath("/admin/sales/loyalty");
  revalidatePath("/admin/catalog/loyalty");
  redirect(buildSalesLoyaltyPageHref({
    currencyCode: parsed.data.currencyCode,
    query: parsed.data.query,
    page: parsed.data.page,
    success: "Loyalty points granted.",
  }));
}
