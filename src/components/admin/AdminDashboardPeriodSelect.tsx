"use client";

import type { AdminPeriod } from "@/lib/admin/admin-analytics-service";

export default function AdminDashboardPeriodSelect({ period }: { period: AdminPeriod }) {
  return (
    <form method="get" className="flex items-center gap-2">
      <label htmlFor="dashboard-period" className="text-sm text-[#4b5a72]">
        Period
      </label>
      <select
        id="dashboard-period"
        name="period"
        defaultValue={period}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-md border border-[#d3dbe5] bg-white px-3 py-1.5 text-sm text-[#1f2735]"
      >
        <option value="last7Days">Last 7 days</option>
        <option value="last30Days">Last 30 days</option>
        <option value="last90Days">Last 90 days</option>
      </select>
    </form>
  );
}

