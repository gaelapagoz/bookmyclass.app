import Link from "next/link";

import { createSubscriptionAction } from "@/app/admin/(private)/actions";
import { getAdminSubscriptionOptions } from "@/lib/admin/admin-catalog-core-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminSubscriptionCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { clients, products, prices } = await getAdminSubscriptionOptions();
  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Subscription</h1>
        <Link href="/admin/subscriptions" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to subscriptions
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={createSubscriptionAction} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Client
            <select name="clientId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.email})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Product
            <select name="productId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Price
          <select name="priceId" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
            {prices.map((price) => (
              <option key={price.id} value={price.id}>
                {price.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Starts At
            <input name="startsAt" type="datetime-local" required className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Current Period Start
            <input
              name="currentPeriodStart"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Current Period End
            <input
              name="currentPeriodEnd"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Status
            <select name="status" defaultValue="ACTIVE" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="PAST_DUE">PAST_DUE</option>
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Provider
            <select name="provider" defaultValue="STRIPE" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="STRIPE">STRIPE</option>
              <option value="MOLLIE">MOLLIE</option>
              <option value="MANUAL">MANUAL</option>
              <option value="OTHER">OTHER</option>
            </select>
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Provider Reference
          <input name="providerSubscriptionReference" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="cancelAtPeriodEnd" /> Cancel at period end
        </label>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Save subscription
        </button>
      </form>
    </section>
  );
}

