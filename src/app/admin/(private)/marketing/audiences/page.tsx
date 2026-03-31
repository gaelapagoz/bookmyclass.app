import MarketingAudienceEstimator from "@/components/admin/marketing/MarketingAudienceEstimator";
import { estimateAudienceForCampaign } from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{ audience?: string; error?: string }>;
type MarketingAudienceValue = "ALL_USERS" | "ACTIVE_USERS" | "PAYING_SUBSCRIBERS" | "MANUAL";

const MARKETING_AUDIENCE = {
  ALL_USERS: "ALL_USERS",
  ACTIVE_USERS: "ACTIVE_USERS",
  PAYING_SUBSCRIBERS: "PAYING_SUBSCRIBERS",
  MANUAL: "MANUAL",
} as const satisfies Record<MarketingAudienceValue, MarketingAudienceValue>;

function resolveAudience(value: string | undefined): MarketingAudienceValue {
  if (value === MARKETING_AUDIENCE.ACTIVE_USERS) {
    return MARKETING_AUDIENCE.ACTIVE_USERS;
  }
  if (value === MARKETING_AUDIENCE.PAYING_SUBSCRIBERS) {
    return MARKETING_AUDIENCE.PAYING_SUBSCRIBERS;
  }
  if (value === MARKETING_AUDIENCE.MANUAL) {
    return MARKETING_AUDIENCE.MANUAL;
  }
  return MARKETING_AUDIENCE.ALL_USERS;
}

export default async function AdminMarketingAudiencesPage({ searchParams }: { searchParams: SearchParams }) {
  const { audience, error } = await searchParams;
  const selectedAudience = resolveAudience(audience);

  const estimate = await estimateAudienceForCampaign({
    audienceType: selectedAudience,
    manualAudienceJson: selectedAudience === MARKETING_AUDIENCE.MANUAL ? { emails: [], userIds: [] } : null,
  });

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Marketing Audiences</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Audience definitions available for campaign targeting.</p>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <h3 className="text-base font-semibold text-[#1f2735]">Audience type</h3>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <a href="/admin/marketing/audiences?audience=ALL_USERS" className={`rounded-md border px-3 py-1.5 ${selectedAudience === MARKETING_AUDIENCE.ALL_USERS ? "border-[#1d3652] bg-[#1d3652] text-white" : "border-[#d3dbe5]"}`}>All users</a>
          <a href="/admin/marketing/audiences?audience=ACTIVE_USERS" className={`rounded-md border px-3 py-1.5 ${selectedAudience === MARKETING_AUDIENCE.ACTIVE_USERS ? "border-[#1d3652] bg-[#1d3652] text-white" : "border-[#d3dbe5]"}`}>Active users</a>
          <a href="/admin/marketing/audiences?audience=PAYING_SUBSCRIBERS" className={`rounded-md border px-3 py-1.5 ${selectedAudience === MARKETING_AUDIENCE.PAYING_SUBSCRIBERS ? "border-[#1d3652] bg-[#1d3652] text-white" : "border-[#d3dbe5]"}`}>Paying subscribers</a>
          <a href="/admin/marketing/audiences?audience=MANUAL" className={`rounded-md border px-3 py-1.5 ${selectedAudience === MARKETING_AUDIENCE.MANUAL ? "border-[#1d3652] bg-[#1d3652] text-white" : "border-[#d3dbe5]"}`}>Manual users/emails</a>
        </div>
      </section>

      <MarketingAudienceEstimator totalResolved={estimate.totalResolved} totalAfterUnsubscribe={estimate.totalAfterUnsubscribe} />
    </section>
  );
}

