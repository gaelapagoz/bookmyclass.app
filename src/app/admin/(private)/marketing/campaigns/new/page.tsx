import Link from "next/link";

import { createMarketingCampaignDraftAction } from "@/app/admin/(private)/actions";
import MarketingCampaignForm from "@/components/admin/marketing/MarketingCampaignForm";
import { listMarketingCategories } from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminMarketingCampaignCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;

  try {
    const categories = await listMarketingCategories();

    return (
      <section className="space-y-4">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Create Campaign</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Build a draft campaign with block-based content.</p>
          </div>
          <Link href="/admin/marketing/campaigns" className="text-sm text-[#2a4f78] underline underline-offset-4">
            Back to campaigns
          </Link>
        </header>

        {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

        <MarketingCampaignForm
          mode="create"
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          submitAction={createMarketingCampaignDraftAction}
        />
      </section>
    );
  } catch {
    return (
      <section className="rounded-xl border border-[#d3dbe5] bg-white p-6">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Create Campaign</h1>
        <p className="mt-2 text-sm text-[#7b2d2d]">Unable to load creator right now.</p>
      </section>
    );
  }
}
