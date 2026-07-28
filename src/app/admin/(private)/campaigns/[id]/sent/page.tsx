import Link from "next/link";

import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import { getMarketingCampaignFlowDraftById, getMarketingCampaignFlowSentSummary } from "@/lib/marketing/marketing-service";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function AdminMarketingCampaignSentPage({ params }: { params: Params }) {
  const { id } = await params;
  const [draft, sentSummary] = await Promise.all([
    getMarketingCampaignFlowDraftById(id),
    getMarketingCampaignFlowSentSummary(id),
  ]);

  const selectedSegmentsLabel = sentSummary?.selectedSegmentNames?.length
    ? sentSummary.selectedSegmentNames.join(", ")
    : "All subscribed clients";

  return (
    <CampaignFlowLayout
      title="Campaign Sent"
      description="Your campaign send has been confirmed."
      topBackHref="/admin/campaigns"
      controls={
        <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5">
          <section className="rounded-md border border-[#d7f0dc] bg-[#f2fbf4] p-4">
            <h2 className="text-base font-semibold text-[#166534]">Campaign sent successfully</h2>
            <p className="mt-2 text-sm text-[#22543d]">
              Final delivery completed for this campaign.
            </p>
          </section>

          <section className="rounded-md border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <h3 className="text-sm font-semibold text-[#1f2735]">Summary</h3>
            <dl className="mt-2 space-y-1 text-sm text-[#334155]">
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a6d86]">Campaign name</dt>
                <dd>{sentSummary?.campaignName ?? draft?.name ?? "-"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a6d86]">Status</dt>
                <dd>{sentSummary?.status ?? "SENT"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a6d86]">Recipients sent</dt>
                <dd>{sentSummary?.recipientCount ?? 0}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-[#5a6d86]">Category</dt>
                <dd>{sentSummary?.categoryName ?? draft?.categoryName ?? "No category"}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[#5a6d86]">Selected segments</dt>
                <dd>{selectedSegmentsLabel}</dd>
              </div>
            </dl>
          </section>

          <Link
            href="/admin/campaigns"
            className="inline-flex rounded-md bg-[#1d3652] px-4 py-2 text-sm font-medium text-white"
          >
            Go to campaigns
          </Link>
        </section>
      }
      preview={<CampaignPreview fromName={draft?.fromName} subject={draft?.subject} previewText={draft?.previewText} htmlSnapshot={draft?.htmlSnapshot} />}
    />
  );
}
