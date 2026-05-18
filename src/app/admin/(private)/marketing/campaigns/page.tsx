import Link from "next/link";

import AdminListControls from "@/components/admin/AdminListControls";
import AdminPagination from "@/components/admin/AdminPagination";
import MarketingCampaignTable from "@/components/admin/marketing/MarketingCampaignTable";
import {
  getMarketingCampaignGlobalMetrics,
  getMarketingCampaignListPageData,
  type MarketingCampaignPageFilter,
} from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{
  status?: string | string[];
  page?: string | string[];
  q?: string | string[];
  error?: string;
}>;

const FILTER_OPTIONS: Array<{ value: MarketingCampaignPageFilter; label: string }> = [
  { value: "all", label: "All campaigns" },
  { value: "draft", label: "Draft campaigns" },
  { value: "sent", label: "Sent campaigns" },
];

function resolveFilter(value: string | string[] | undefined): MarketingCampaignPageFilter {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw === "draft") {
    return "draft";
  }
  if (raw === "sent") {
    return "sent";
  }
  return "all";
}

function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function parseQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function buildPageHref(page: number, filter: MarketingCampaignPageFilter, query: string): string {
  const search = new URLSearchParams();
  search.set("page", String(page));
  search.set("status", filter);
  if (query) {
    search.set("q", query);
  }
  return `/admin/marketing/campaigns?${search.toString()}`;
}

function formatDate(value: Date | null): string | null {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-BE").format(value);
}

function formatAverage(value: number): string {
  return new Intl.NumberFormat("en-BE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
}

export default async function AdminMarketingCampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const { status, page: rawPage, q, error } = await searchParams;
  const filter = resolveFilter(status);
  const page = parsePage(rawPage);
  const query = parseQuery(q);

  const [list, metrics] = await Promise.all([
    getMarketingCampaignListPageData({ page, filter, query, pageSize: 20 }),
    getMarketingCampaignGlobalMetrics(),
  ]);

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Marketing Campaigns</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Manage draft and sent campaigns for marketing communications.</p>
        </div>
        <Link href="/admin/marketing/campaigns/new" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white">
          + Create campaign
        </Link>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total campaigns</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatCount(metrics.totalCampaigns)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total sent campaigns</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatCount(metrics.totalSentCampaigns)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total draft campaigns</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatCount(metrics.totalDraftCampaigns)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Sent in last 30 days</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatCount(metrics.sentInLast30Days)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Total recipients reached</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatCount(metrics.totalRecipientsReached)}</p>
        </article>
        <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Avg recipients per sent campaign</p>
          <p className="mt-1 text-xl font-semibold text-[#1f2735]">{formatAverage(metrics.averageRecipientsPerSentCampaign)}</p>
        </article>
      </section>

      <AdminListControls
        basePath="/admin/marketing/campaigns"
        filterName="status"
        filterValue={list.filter}
        filterOptions={FILTER_OPTIONS}
        searchName="q"
        searchValue={query}
        searchPlaceholder="Search campaign, subject, or category"
        searchAriaLabel="Search campaigns"
      />

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <MarketingCampaignTable
        rows={list.items.map((row) => ({
          id: row.id,
          name: row.name,
          categoryName: row.categoryName,
          status: row.status,
          updatedAt: formatDate(row.updatedAt) ?? "-",
          sentAt: formatDate(row.sentAt),
          recipientCount: row.recipientCount,
        }))}
      />

      <AdminPagination
        page={list.page}
        totalPages={list.totalPages}
        onChange={(nextPage) => buildPageHref(nextPage, list.filter, list.query)}
      />
    </section>
  );
}
