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
  setAdminStoreProductActiveState,
} from "@/lib/store/store-admin-catalog-service";
import {
  ProductMediaError,
  unlinkStoreProductImage,
  uploadStoreProductImage,
  validateProductImageUpload,
} from "@/lib/media/product-media-service";
import { getProductImageUploadLimitLabel } from "@/lib/media/product-image-config";
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

function getImageFile(formData: FormData): File | null {
  const value = formData.get("image");
  return value instanceof File && value.size > 0 ? value : null;
}

function getStoreActionErrorMessage(error: unknown): string {
  if (error instanceof ProductMediaError) {
    if (error.code === "IMAGE_TOO_LARGE") {
      return `Image exceeds the ${getProductImageUploadLimitLabel()} upload limit.`;
    }
    if (error.code === "UNSUPPORTED_MIME_TYPE" || error.code === "UNSUPPORTED_EXTENSION") {
      return "Upload a JPEG, PNG, or WebP image.";
    }
    if (error.code === "SIGNATURE_MISMATCH") {
      return "The uploaded file does not contain a valid JPEG, PNG, or WebP image.";
    }
    if (error.code === "UNSAFE_FILENAME") {
      return "The uploaded filename is not allowed.";
    }

    return error.message;
  }

  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

// ---------------------------------------------------------------------------
// Merchandise actions
// ---------------------------------------------------------------------------

export async function createStoreMerchandiseAction(formData: FormData) {
  const session = await requireAdminSession();
  await assertSameOriginServerAction();
  const imageFile = getImageFile(formData);

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
    if (imageFile) {
      await validateProductImageUpload(imageFile);
    }

    const created = await createAdminStoreMerchandise({
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
      isActive: imageFile ? false : parsed.data.isActive,
    });
    if (imageFile) {
      await uploadStoreProductImage({
        productId: created.id,
        uploadedById: session.user.id,
        file: imageFile,
      });
      if (parsed.data.isActive) {
        await setAdminStoreProductActiveState(created.id, true);
      }
    }
  } catch (err) {
    const code = getStoreActionErrorMessage(err);
    redirect(`/admin/store/merchandise/new?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function updateStoreMerchandiseAction(id: string, formData: FormData) {
  const session = await requireAdminSession();
  await assertSameOriginServerAction();
  const imageFile = getImageFile(formData);
  const shouldRemoveImage = isChecked(formData, "removeImage");
  const willUploadImage = imageFile && !shouldRemoveImage;

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
    if (willUploadImage) {
      await validateProductImageUpload(imageFile);
    }

    await updateAdminStoreMerchandise(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      isActive: willUploadImage ? false : parsed.data.isActive,
      isArchived: false,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
    });
    if (shouldRemoveImage) {
      await unlinkStoreProductImage(id);
    } else if (willUploadImage) {
      await uploadStoreProductImage({
        productId: id,
        uploadedById: session.user.id,
        file: imageFile,
      });
      if (parsed.data.isActive) {
        await setAdminStoreProductActiveState(id, true);
      }
    }
  } catch (err) {
    const code = getStoreActionErrorMessage(err);
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
  const session = await requireAdminSession();
  const imageFile = getImageFile(formData);

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
    await assertSameOriginServerAction();
    if (imageFile) {
      await validateProductImageUpload(imageFile);
    }

    const created = await createAdminStoreGiftCardProduct({
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
      isActive: imageFile ? false : parsed.data.isActive,
    });
    if (imageFile) {
      await uploadStoreProductImage({
        productId: created.id,
        uploadedById: session.user.id,
        file: imageFile,
      });
      if (parsed.data.isActive) {
        await setAdminStoreProductActiveState(created.id, true);
      }
    }
  } catch (err) {
    const code = getStoreActionErrorMessage(err);
    redirect(`/admin/store/gift-cards/new?error=${encodeURIComponent(code)}`);
  }

  redirect("/admin/store");
}

export async function updateStoreGiftCardAction(id: string, formData: FormData) {
  const session = await requireAdminSession();
  await assertSameOriginServerAction();
  const imageFile = getImageFile(formData);
  const shouldRemoveImage = isChecked(formData, "removeImage");
  const willUploadImage = imageFile && !shouldRemoveImage;

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
    if (willUploadImage) {
      await validateProductImageUpload(imageFile);
    }

    await updateAdminStoreGiftCardProduct(id, {
      name: parsed.data.name,
      description: parsed.data.description,
      sortOrder: parsed.data.sortOrder,
      isActive: willUploadImage ? false : parsed.data.isActive,
      isArchived: false,
      priceName: parsed.data.priceName,
      unitAmountMinor: parsed.data.unitAmount,
    });
    if (shouldRemoveImage) {
      await unlinkStoreProductImage(id);
    } else if (willUploadImage) {
      await uploadStoreProductImage({
        productId: id,
        uploadedById: session.user.id,
        file: imageFile,
      });
      if (parsed.data.isActive) {
        await setAdminStoreProductActiveState(id, true);
      }
    }
  } catch (err) {
    const code = getStoreActionErrorMessage(err);
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
