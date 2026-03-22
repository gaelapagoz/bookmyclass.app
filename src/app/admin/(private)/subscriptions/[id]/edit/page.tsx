import Link from "next/link";
import { notFound } from "next/navigation";

import { updateSubscriptionAction } from "@/app/admin/(private)/actions";
import { getAdminSubscriptionById } from "@/lib/admin/admin-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string }>;

function toDateTimeLocal(value: Date): string {
  const iso = new Date(value).toISOString();
  return iso.slice(0, 16);
}

export default async function AdminSubscriptionEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const record = await getAdminSubscriptionById(id);

  if (!record) {
    notFound();
  }

  const { error } = await searchParams;

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Subscription</h1>
        <Link href="/admin/subscriptions" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to subscriptions
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <form action={updateSubscriptionAction.bind(null, id)} className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            Current Period Start
            <input
              name="currentPeriodStart"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.currentPeriodStart)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Current Period End
            <input
              name="currentPeriodEnd"
              type="datetime-local"
              required
              defaultValue={toDateTimeLocal(record.currentPeriodEnd)}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Status
            <select
              name="status"
              defaultValue={record.status}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            >
              <option value="PENDING">PENDING</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="EXPIRED">EXPIRED</option>
              <option value="PAST_DUE">PAST_DUE</option>
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Cancelled At
            <input
              name="cancelledAt"
              type="datetime-local"
              defaultValue={record.cancelledAt ? toDateTimeLocal(record.cancelledAt) : ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
          <label className="block text-sm text-[#334155]">
            Ended At
            <input
              name="endedAt"
              type="datetime-local"
              defaultValue={record.endedAt ? toDateTimeLocal(record.endedAt) : ""}
              className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
            />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Provider Reference
          <input
            name="providerSubscriptionReference"
            defaultValue={record.providerSubscriptionReference ?? ""}
            className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-[#334155]">
          <input type="checkbox" name="cancelAtPeriodEnd" defaultChecked={record.cancelAtPeriodEnd} /> Cancel at period end
        </label>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          Update subscription
        </button>
      </form>
    </section>
  );
}
