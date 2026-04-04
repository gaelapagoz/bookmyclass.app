import Link from "next/link";

import AdminAtRiskClientsCard from "@/components/admin/AdminAtRiskClientsCard";
import AdminDashboardPeriodSelect from "@/components/admin/AdminDashboardPeriodSelect";
import AdminDashboardSalesAnalytics from "@/components/admin/AdminDashboardSalesAnalytics";
import AdminStaffPerformanceTable from "@/components/admin/AdminStaffPerformanceTable";
import AdminTopClassSessionsCard from "@/components/admin/AdminTopClassSessionsCard";
import AdminTopClientsCard from "@/components/admin/AdminTopClientsCard";
import {
  type AdminPeriod,
  getAdminDashboardData,
  getAdminDashboardInsights,
  getAdminMarketingOverviewMetrics,
  getDashboardTrendData,
  getOperationalMetricCards,
} from "@/lib/admin/admin-service";

type SearchParams = Promise<{ period?: string | string[] }>;

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function resolvePeriod(value: string | string[] | undefined): AdminPeriod {
  if (value === "last7Days" || value === "last30Days" || value === "last90Days") {
    return value;
  }

  return "last30Days";
}

export default async function AdminDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  try {
    const { period: rawPeriod } = await searchParams;
    const period = resolvePeriod(rawPeriod);
    const [data, metricCards, trendData, insights, marketingOverview] = await Promise.all([
      getAdminDashboardData(),
      getOperationalMetricCards(period),
      getDashboardTrendData(period),
      getAdminDashboardInsights(period),
      getAdminMarketingOverviewMetrics(),
    ]);

    return (
      <section className="space-y-6">
        <header>
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Operational summary for the studio.</p>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-[#1f2735]">Sales Analytics</h2>
          <AdminDashboardPeriodSelect period={period} />
          <AdminDashboardSalesAnalytics cards={metricCards} trend={trendData} period={period} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Booking Analytics</h2>

          <div className="grid gap-4 xl:grid-cols-3">
            <AdminTopClassSessionsCard items={insights.topClassSessions} className="xl:col-span-2" />
            <article className="rounded-xl border border-[#d3dbe5] bg-white p-4 xl:col-span-1">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-[#1f2735]">Upcoming Sessions</h3>
                <Link href="/admin/sessions" className="text-xs text-[#2a4f78] underline underline-offset-4">
                  View all
                </Link>
              </div>

              {data.upcomingSessions.length === 0 ? (
                <p className="mt-2 text-sm text-[#4b5a72]">No upcoming sessions.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.upcomingSessions.slice(0, 8).map((session) => (
                    <li key={session.id} className="rounded-md border border-[#e2e8f0] px-3 py-2">
                      <p className="text-sm font-medium text-[#1f2735]">{session.title}</p>
                      <p className="text-xs text-[#5a6d86]">{formatDateTime(session.startsAt)}</p>
                      <p className="text-xs text-[#5a6d86]">
                        {session.bookedSpots}/{session.capacity} booked
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AdminTopClientsCard items={insights.topClients} />
            <AdminAtRiskClientsCard items={insights.atRiskClients} />
          </div>

          <AdminStaffPerformanceTable items={insights.staffPerformance} />
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-[#1f2735]">Marketing Analytics</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Never Subscribed</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{marketingOverview.neverSubscribedClients}</p>
            </article>
            <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Subscribed</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{marketingOverview.subscribedClients}</p>
            </article>
            <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Unsubscribed</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{marketingOverview.unsubscribedClients}</p>
            </article>
            <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Campaigns Sent</p>
              <p className="mt-1 text-xl font-semibold text-[#1f2735]">{marketingOverview.campaignsSent}</p>
            </article>
          </div>
        </section>
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Dashboard</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load dashboard data right now.</p>
      </section>
    );
  }
}
