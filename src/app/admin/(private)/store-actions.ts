"use server";

import { z } from "zod";
import { redirect } from "next/navigation";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { assertSameOriginServerAction } from "@/lib/security/same-origin";
import {
  archiveAdminStoreMerchandise,
  archiveAdminStoreGiftCardProduct,
  createAdminStoreMerchandise,
  createAdminStoreGiftCardProduct,
  updateAdminStoreMerchandise,
  updateAdminStoreGiftCardProduct,
  getAdminStoreMerchandiseById,
  getAdminStoreGiftCardById,
} from "@/lib/store/store-admin-catalog-service";
import { attemptStorePriceSyncFromEnv } from "@/lib/store/store-stripe-sync-service";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const merchandiseSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0),
  priceName: z.string().optional(),
  unitAmount: z.coerce
    .number()
    .positive()
    .transform((v) => Math.round(v * 100)),
  isActive: z.boolean(),
});

const giftCardSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0),
  priceName: z.string().optional(),
  unitAmount: z.coerce
    .number()
    .positive()
    .transform((v) => Math.round(v * 100)),
  isActive: z.boolean(),
});

function isChecked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

// ---------------------------------------------------------------------------
// Merchandise actions
// ---------------------------------------------------------------------------

export async function createStoreMerchandiseAction(formData: FormData) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const parsed = merchandiseSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    unitAmount: formData.get("unitAmount"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!parsed.success) {
    const msg = encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.");
    redirect(`/admin/store/merchandise/new?error=${msg}`);
  }

  try {
    await createAdminStoreMerchandise({
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
      isActive: parsed.data.isActive,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/merchandise/new?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function updateStoreMerchandiseAction(id: string, formData: FormData) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const parsed = merchandiseSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    unitAmount: formData.get("unitAmount"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!parsed.success) {
    const msg = encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.");
    redirect(`/admin/store/merchandise/${id}/edit?error=${msg}`);
  }

  try {
    await updateAdminStoreMerchandise(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
      isArchived: false,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/merchandise/${id}/edit?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function archiveStoreMerchandiseAction(id: string) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  try {
    await archiveAdminStoreMerchandise(id);
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/merchandise/${id}/edit?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

// ---------------------------------------------------------------------------
// Gift Card catalog actions
// ---------------------------------------------------------------------------

export async function createStoreGiftCardAction(formData: FormData) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const parsed = giftCardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    unitAmount: formData.get("unitAmount"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!parsed.success) {
    const msg = encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.");
    redirect(`/admin/store/gift-cards/new?error=${msg}`);
  }

  try {
    await createAdminStoreGiftCardProduct({
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
      isActive: parsed.data.isActive,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/gift-cards/new?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function updateStoreGiftCardAction(id: string, formData: FormData) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const parsed = giftCardSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") ?? undefined,
    sortOrder: formData.get("sortOrder"),
    priceName: formData.get("priceName") ?? undefined,
    unitAmount: formData.get("unitAmount"),
    isActive: isChecked(formData, "isActive"),
  });

  if (!parsed.success) {
    const msg = encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input.");
    redirect(`/admin/store/gift-cards/${id}/edit?error=${msg}`);
  }

  try {
    await updateAdminStoreGiftCardProduct(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      isActive: parsed.data.isActive,
      isArchived: false,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
    });
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/gift-cards/${id}/edit?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function archiveStoreGiftCardAction(id: string) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  try {
    await archiveAdminStoreGiftCardProduct(id);
  } catch (err) {
    const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    redirect(`/admin/store/gift-cards/${id}/edit?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

// ---------------------------------------------------------------------------
// Stripe sync retry actions
// ---------------------------------------------------------------------------

export async function retryStoreMerchandiseSyncAction(id: string) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const product = await getAdminStoreMerchandiseById(id);
  if (!product?.primaryPrice) {
    redirect(`/admin/store/merchandise/${id}/edit?error=${encodeURIComponent("NO_ACTIVE_PRICE")}`);
  }

  const result = await attemptStorePriceSyncFromEnv(product.primaryPrice.id);
  if (!result) {
    redirect(`/admin/store/merchandise/${id}/edit?error=${encodeURIComponent("STRIPE_NOT_CONFIGURED")}`);
  }
  if (result.synced) {
    redirect(`/admin/store/merchandise/${id}/edit?success=STRIPE_SYNCED`);
  }
  redirect(`/admin/store/merchandise/${id}/edit?error=${encodeURIComponent(result.reason)}`);
}

export async function retryStoreGiftCardSyncAction(id: string) {
  await requireAdminSession();
  await assertSameOriginServerAction();

  const product = await getAdminStoreGiftCardById(id);
  if (!product?.activePrice) {
    redirect(`/admin/store/gift-cards/${id}/edit?error=${encodeURIComponent("NO_ACTIVE_PRICE")}`);
  }

  const result = await attemptStorePriceSyncFromEnv(product.activePrice.id);
  if (!result) {
    redirect(`/admin/store/gift-cards/${id}/edit?error=${encodeURIComponent("STRIPE_NOT_CONFIGURED")}`);
  }
  if (result.synced) {
    redirect(`/admin/store/gift-cards/${id}/edit?success=STRIPE_SYNCED`);
  }
  redirect(`/admin/store/gift-cards/${id}/edit?error=${encodeURIComponent(result.reason)}`);
}
