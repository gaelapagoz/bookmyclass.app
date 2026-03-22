import Link from "next/link";
import { notFound } from "next/navigation";

import { updatePlanAction } from "@/app/admin/(private)/actions";
import { getAdminPlanById } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

export default async function AdminPlanEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const record = await getAdminPlanById(id);

  if (!record) {
    notFound();
  }

  const currentPrice = record.prices[0] ?? null;
  const isCheckoutReady = Boolean(currentPrice?.stripePriceId);
  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Plan</h1>
        <Link href="/admin/plans" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to plans
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updatePlanAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
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
            Product Type
            <select
              name="productType"
              defaultValue={record.productType}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              <option value="DROP_IN_CLASS">DROP_IN_CLASS</option>
              <option value="CLASS_PACK">CLASS_PACK</option>
              <option value="UNLIMITED_MEMBERSHIP">UNLIMITED_MEMBERSHIP</option>
              <option value="INTRO_OFFER">INTRO_OFFER</option>
              <option value="PRIVATE_CLASS">PRIVATE_CLASS</option>
              <option value="WORKSHOP_PASS">WORKSHOP_PASS</option>
              <option value="GIFT_CARD">GIFT_CARD</option>
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Slug (auto-generated from name)
          <input
            value={record.slug}
            readOnly
            className="mt-1 w-full rounded-md border border-[#d3dbe5] bg-[#f8fafc] px-3 py-2 text-[#64748b]"
          />
        </label>

        <p className="text-xs text-[#64748b]">Checkout provisioning status: {isCheckoutReady ? "Ready" : "Needs attention"}</p>

        <label className="block text-sm text-[#334155]">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={record.description ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
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
          <label className="block text-sm text-[#334155]">
            Price Label
            <input
              name="priceName"
              defaultValue={currentPrice?.name ?? ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <label className="block text-sm text-[#334155]">
            Price
            <input
              name="unitAmount"
              type="number"
              step="0.01"
              min="0.01"
              required
              defaultValue={currentPrice ? (currentPrice.unitAmountMinor / 100).toFixed(2) : ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Currency
            <input
              name="currencyCode"
              defaultValue={currentPrice?.currencyCode ?? "EUR"}
              maxLength={3}
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2 uppercase"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Billing Type
            <select
              name="priceType"
              defaultValue={currentPrice?.priceType ?? "RECURRING"}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              <option value="RECURRING">Recurring</option>
              <option value="ONE_TIME">One-time</option>
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Interval
            <select
              name="billingInterval"
              defaultValue={currentPrice?.billingInterval ?? "MONTH"}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              <option value="DAY">Day</option>
              <option value="WEEK">Week</option>
              <option value="MONTH">Month</option>
              <option value="YEAR">Year</option>
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Interval Count
          <input
            name="billingIntervalCount"
            type="number"
            min={1}
            defaultValue={currentPrice?.billingIntervalCount ?? 1}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <div className="flex items-center justify-between gap-3 pt-2">
          <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
            <input type="checkbox" name="isActive" defaultChecked={record.isActive} /> Active
          </label>

          <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Update plan
          </button>
        </div>
      </form>
    </section>
  );
}

