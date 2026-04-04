import { deleteMarketingCampaignDraftAction, duplicateMarketingCampaignAction } from "@/app/admin/(private)/actions";
import MarketingCampaignTable from "@/components/admin/marketing/MarketingCampaignTable";
import {
  listMarketingCampaignListItems,
  type MarketingCampaignPageFilter,
} from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{ status?: string; error?: string }>;

function resolveFilter(value: string | undefined): MarketingCampaignPageFilter {
  if (value === "draft") {
    return "draft";
  }
  if (value === "sent") {
    return "sent";
  }
  return "all";
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

export default async function AdminMarketingCampaignsPage({ searchParams }: { searchParams: SearchParams }) {
  const { status, error } = await searchParams;
  const filter = resolveFilter(status);
  const rows = await listMarketingCampaignListItems(filter);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Marketing Campaigns</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Manage draft and sent campaigns for marketing communications.</p>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <MarketingCampaignTable
        activeFilter={filter}
        rows={rows.map((row) => ({
          id: row.id,
          name: row.name,
          categoryName: row.categoryName,
          status: row.status,
          audience: row.audience,
          updatedAt: formatDate(row.updatedAt) ?? "-",
          sentAt: formatDate(row.sentAt),
          openRate: row.openRate,
          clickRate: row.clickRate,
        }))}
      />

      <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <h3 className="text-base font-semibold text-[#1f2735]">Campaign actions</h3>
        <p className="mt-1 text-sm text-[#4b5a72]">Duplicate or delete a draft campaign by ID.</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <form action={duplicateMarketingCampaignAction} className="flex items-center gap-2">
            <input name="campaignId" placeholder="Campaign ID" className="rounded-md border border-[#d3dbe5] px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm">Duplicate</button>
          </form>
          <form action={deleteMarketingCampaignDraftAction} className="flex items-center gap-2">
            <input name="campaignId" placeholder="Campaign ID" className="rounded-md border border-[#d3dbe5] px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#7b2d2d]">Delete draft</button>
          </form>
        </div>
      </section>
    </section>
  );
}
