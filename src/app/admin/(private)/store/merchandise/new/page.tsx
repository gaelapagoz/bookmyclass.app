import Link from "next/link";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { createStoreMerchandiseAction } from "@/app/admin/(private)/store-actions";
import { STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminStoreMerchandiseNewPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminSession();
  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Add Merchandise</h1>
        <Link
          href="/admin/store"
          className="text-sm text-[#2a4f78] underline underline-offset-4"
        >
          Back to Store
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form
        action={createStoreMerchandiseAction}
        className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5"
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Name
            <input
              name="name"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Sort Order
            <input
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={910}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Product Image
          <input
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
          <span className="mt-1 block text-xs text-[#64748b]">
            JPEG, PNG, or WebP. Maximum size is 5 MB unless configured otherwise.
          </span>
        </label>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea
            name="description"
            rows={2}
            defaultValue={STORE_PICKUP_WORDING}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
          <span className="mt-1 block text-xs text-[#64748b]">
            Pickup-only wording is enforced. Description will display on the Store page.
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
              placeholder="e.g. 22.00"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Price Label
            <input
              name="priceName"
              placeholder="e.g. Studio Tote Bag"
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
          Currency: EUR — Billing: One-time — Fulfillment: Pickup at studio. Price requires Stripe
          sync before checkout exposure.
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked /> Active
          </label>
          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Save merchandise
          </button>
        </div>
      </form>
    </section>
  );
}
