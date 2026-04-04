import Link from "next/link";
import { MarketingSubscriptionStatus } from "@prisma/client";

import type { AdminUserItem } from "@/lib/admin/admin-service";

type MarketingSegmentOption = {
  id: string;
  name: string;
};

type MarketingBulkActions = {
  segments: MarketingSegmentOption[];
  setStatusAction: (formData: FormData) => void | Promise<void>;
  addSegmentsAction: (formData: FormData) => void | Promise<void>;
  removeSegmentsAction: (formData: FormData) => void | Promise<void>;
};

type Props = {
  title: string;
  users: AdminUserItem[];
  marketingBulkActions?: MarketingBulkActions;
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMarketingStatus(value: MarketingSubscriptionStatus): string {
  if (value === MarketingSubscriptionStatus.SUBSCRIBED) {
    return "Subscribed";
  }
  if (value === MarketingSubscriptionStatus.UNSUBSCRIBED) {
    return "Unsubscribed";
  }
  return "Never Subscribed";
}

export default function AdminUsersRoleTable({ title, users, marketingBulkActions }: Props) {
  if (!marketingBulkActions) {
    return (
      <article className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
        <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
          <h2 className="text-base font-semibold text-[#1f2735]">{title}</h2>
        </div>
        {users.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[#4b5a72]">No users in this role.</p>
        ) : (
          <table className="min-w-full table-fixed text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="w-[26%] px-3 py-2">Name</th>
                <th className="w-[29%] px-3 py-2">Email</th>
                <th className="w-[12%] px-3 py-2">Status</th>
                <th className="w-[23%] px-3 py-2">Last Login</th>
                <th className="w-[10%] px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.email}</td>
                  <td className="px-3 py-2">{item.isActive ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2">{formatDateTime(item.lastLoginAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    );
  }

  return (
    <article className="overflow-x-auto rounded-xl border border-[#d3dbe5] bg-white">
      <div className="border-b border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
        <h2 className="text-base font-semibold text-[#1f2735]">{title}</h2>
      </div>

      {users.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#4b5a72]">No users in this role.</p>
      ) : (
        <form className="space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">
              Subscription status
              <select
                name="marketingSubscriptionStatus"
                defaultValue={MarketingSubscriptionStatus.SUBSCRIBED}
                className="mt-1 block w-full rounded-md border border-[#d3dbe5] px-3 py-2 text-sm font-normal text-[#1f2735]"
                aria-label="Marketing subscription status"
              >
                <option value={MarketingSubscriptionStatus.SUBSCRIBED}>Subscribed</option>
                <option value={MarketingSubscriptionStatus.UNSUBSCRIBED}>Unsubscribed</option>
                <option value={MarketingSubscriptionStatus.NEVER_SUBSCRIBED}>Never subscribed</option>
              </select>
            </label>

            <label className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86] md:col-span-2">
              Segments
              <select
                name="segmentIds"
                multiple
                className="mt-1 block min-h-24 w-full rounded-md border border-[#d3dbe5] px-3 py-2 text-sm font-normal text-[#1f2735]"
                aria-label="Marketing segments"
              >
                {marketingBulkActions.segments.map((segment) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              formAction={marketingBulkActions.setStatusAction}
              className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
            >
              Set subscription status
            </button>
            <button
              type="submit"
              formAction={marketingBulkActions.addSegmentsAction}
              className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
            >
              Add segments
            </button>
            <button
              type="submit"
              formAction={marketingBulkActions.removeSegmentsAction}
              className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
            >
              Remove segments
            </button>
          </div>

          <table className="min-w-full table-fixed text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="w-[7%] px-3 py-2">Select</th>
                <th className="w-[16%] px-3 py-2">Name</th>
                <th className="w-[20%] px-3 py-2">Email</th>
                <th className="w-[10%] px-3 py-2">Status</th>
                <th className="w-[16%] px-3 py-2">Marketing</th>
                <th className="w-[20%] px-3 py-2">Segments</th>
                <th className="w-[11%] px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2">
                    <input type="checkbox" name="userIds" value={item.id} aria-label={`Select ${item.email}`} />
                  </td>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.email}</td>
                  <td className="px-3 py-2">{item.isActive ? "Active" : "Inactive"}</td>
                  <td className="px-3 py-2">{formatMarketingStatus(item.marketingSubscriptionStatus)}</td>
                  <td className="px-3 py-2">{item.marketingSegmentNames.length > 0 ? item.marketingSegmentNames.join(", ") : "\u2014"}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/users/${item.id}/edit`} className="text-[#2a4f78] underline underline-offset-4">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      )}
    </article>
  );
}
