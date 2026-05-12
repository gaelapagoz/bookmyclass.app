import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  archiveStoreMerchandiseAction,
  updateStoreMerchandiseAction,
} from "@/app/admin/(private)/store-actions";
import {
  getAdminStoreMerchandiseById,
  getStorePriceCheckoutReadinessLabel,
} from "@/lib/store/store-admin-catalog-service";
import { STORE_CURRENCY_CODE, STORE_PICKUP_WORDING } from "@/lib/store/store-constants";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function formatMoney(amountMinor: number) {
  return new Intl.NumberFormat("en-BE", {
    style: "currency",
    currency: STORE_CURRENCY_CODE,
  }).format(amountMinor / 100);
}

export default async function AdminStoreMerchandiseEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireAdminSession();
  const { id } = await params;
  const { error } = await searchParams;

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

        <div className="rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-xs text-[#64748b]">
          Current price:{" "}
          {record.primaryPrice ? formatMoney(record.primaryPrice.unitAmountMinor) : "None"} —
          Checkout: {priceLabel}
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
