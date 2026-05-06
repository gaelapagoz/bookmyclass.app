"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketingSubscriptionStatus } from "@prisma/client";

import type { AdminUserItem } from "@/lib/admin/admin-service";

type MarketingSegmentOption = {
  id: string;
  name: string;
};

type Props = {
  users: AdminUserItem[];
  segments: MarketingSegmentOption[];
  setStatusAction: (formData: FormData) => void | Promise<void>;
  addSegmentsAction: (formData: FormData) => void | Promise<void>;
  removeSegmentsAction: (formData: FormData) => void | Promise<void>;
};

function formatMarketingStatus(value: MarketingSubscriptionStatus): string {
  if (value === MarketingSubscriptionStatus.SUBSCRIBED) {
    return "Subscribed";
  }
  if (value === MarketingSubscriptionStatus.UNSUBSCRIBED) {
    return "Unsubscribed";
  }
  return "Never Subscribed";
}

export default function AdminUsersBulkMarketingForm({
  users,
  segments,
  setStatusAction,
  addSegmentsAction,
  removeSegmentsAction,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const currentPageIds = users.map((user) => user.id);
  const allCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id));

  function toggleCurrentPage(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      currentPageIds.forEach((id) => {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      });
      return next;
    });
  }

  function toggleUser(userId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return next;
    });
  }

  return (
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
            {segments.map((segment) => (
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
          formAction={setStatusAction}
          className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
        >
          Set subscription status
        </button>
        <button
          type="submit"
          formAction={addSegmentsAction}
          className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
        >
          Add segments
        </button>
        <button
          type="submit"
          formAction={removeSegmentsAction}
          className="rounded-md border border-[#d3dbe5] px-3 py-2 text-sm text-[#1f2735] hover:bg-[#f3f6fb]"
        >
          Remove segments
        </button>
      </div>

      <table className="min-w-full table-fixed text-sm">
        <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
          <tr>
            <th className="w-[7%] px-3 py-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Select all clients on this page"
                  checked={allCurrentPageSelected}
                  onChange={(event) => toggleCurrentPage(event.currentTarget.checked)}
                />
                Select
              </label>
            </th>
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
                <input
                  type="checkbox"
                  name="userIds"
                  value={item.id}
                  aria-label={`Select ${item.email}`}
                  checked={selectedIds.has(item.id)}
                  onChange={(event) => toggleUser(item.id, event.currentTarget.checked)}
                />
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
  );
}
