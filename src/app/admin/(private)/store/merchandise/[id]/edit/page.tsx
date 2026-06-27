import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";

import { StripeSyncStatus } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  archiveStoreMerchandiseAction,
  updateStoreMerchandiseAction,
  retryStoreMerchandiseSyncAction,
} from "@/app/admin/(private)/store-actions";
import {
  getAdminStoreMerchandiseById,
  getStorePriceCheckoutReadinessLabel,
} from "@/lib/store/store-admin-catalog-service";
import { getProductImageUploadLimitLabel } from "@/lib/media/product-image-config";
import { STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

export default async function AdminStoreMerchandiseEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdminSession();
  const { id } = await params;
  const { error, success } = await searchParams;
  const imageUploadLimitLabel = getProductImageUploadLimitLabel();

  const record = await getAdminStoreMerchandiseById(id);
  if (!record) notFound();

  const priceLabel = getStorePriceCheckoutReadinessLabel(record.primaryPrice, record);

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Merchandise</h1>
        <Link
          href="/admin/store"
          className="text-sm text-[#2a4f78] underline underline-offset-4"
        >
          Back to Store
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success === "STRIPE_SYNCED" ? (
        <p className="text-sm text-[#1a6b3a]">Stripe sync successful. Product is now checkout-ready.</p>
      ) : null}

      <form
        action={updateStoreMerchandiseAction.bind(null, id)}
        className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Name
            <input
              name="name"
              required
              defaultValue={record.name}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Sort Order
            <input
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={record.sortOrder}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Slug (auto-generated, read-only)
          <input
            value={record.slug}
            readOnly
            className="mt-1 w-full rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-[#64748b]"
          />
        </label>

        <div className="space-y-2 rounded-md border border-[#d3dbe5] bg-[#f8fafc] p-3">
          <p className="text-sm font-medium text-[#334155]">Product Image</p>
          {record.imageAsset ? (
            <div className="flex flex-wrap items-center gap-3">
              <Image
                src={record.imageAsset.path}
                alt={`${record.name} product image`}
                width={96}
                height={96}
                className="h-24 w-24 rounded-md border border-[#d3dbe5] object-cover"
              />
              <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
                <input type="checkbox" name="removeImage" /> Remove current image
              </label>
            </div>
          ) : (
            <p className="text-xs text-[#64748b]">No image uploaded.</p>
          )}
          <label className="block text-sm text-[#334155]">
            Replace Image
            <input
              name="image"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] bg-white px-3 py-2"
            />
            <span className="mt-1 block text-xs text-[#64748b]">
              JPEG, PNG, or WebP. Maximum size is {imageUploadLimitLabel}.
            </span>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea
            name="description"
            rows={2}
            defaultValue={record.description ?? STORE_PICKUP_WORDING}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
          <span className="mt-1 block text-xs text-[#64748b]">
            Pickup-only wording should be included in the description.
          </span>
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Price (EUR)
            <input
              name="unitAmount"
              type="number"
              step="0.01"
              min="0.01"
              required
              defaultValue={
                record.primaryPrice
                  ? (record.primaryPrice.unitAmountMinor / 100).toFixed(2)
                  : ""
              }
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
            <span className="mt-1 block text-xs text-[#64748b]">
              Changing price creates a new price entry; old price is deactivated.
            </span>
          </label>
          <label className="block text-sm text-[#334155]">
            Price Label
            <input
              name="priceName"
              defaultValue={record.primaryPrice?.name ?? record.name}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
          Stripe ID:{" "}
          {record.primaryPrice?.stripePriceId ?? "Not synced"} â€” Checkout: {priceLabel}
          {record.primaryPrice?.stripeSyncError ? (
            <span className="ml-2 text-[#7b2d2d]">({record.primaryPrice.stripeSyncError})</span>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
          </label>
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update merchandise
          </button>
        </div>
      </form>

      {record.primaryPrice &&
      record.primaryPrice.stripeSyncStatus !== StripeSyncStatus.SYNCED ? (
        <form action={retryStoreMerchandiseSyncAction.bind(null, id)}>
          <button
            type="submit"
            className="rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#2a4f78]"
          >
            Retry Stripe sync
          </button>
        </form>
      ) : null}

      {!record.isArchived ? (
        <form action={archiveStoreMerchandiseAction.bind(null, id)}>
          <button
            type="submit"
            className="rounded-md border border-[#d3dbe5] bg-white px-3 py-2 text-sm text-[#7b2d2d]"
          >
            Archive merchandise
          </button>
        </form>
      ) : (
        <div className="rounded-md border border-[#d3dbe5] bg-[#f8fafc] p-3 text-sm text-[#64748b]">
          This item is archived. To restore it, edit the product via the admin service directly.
        </div>
      )}
    </section>
  );
}

