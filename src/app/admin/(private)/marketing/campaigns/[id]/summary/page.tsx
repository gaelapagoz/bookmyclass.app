import { redirect } from "next/navigation";

import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import { getMarketingSentCampaignSummaryById } from "@/lib/marketing/marketing-service";

type Params = Promise<{ id: string }>;

function formatDateTime(value: Date | null): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export default async function AdminMarketingCampaignSummaryPage({ params }: { params: Params }) {
  const { id } = await params;
  const summary = await getMarketingSentCampaignSummaryById(id);

  if (!summary) {
    redirect("/admin/marketing/campaigns");
  }

  if (summary.status !== "SENT") {
    redirect(`/admin/marketing/campaigns/new?campaignId=${summary.campaignId}`);
  }

  const selectedSegmentsLabel = summary.selectedSegmentNames.length
    ? summary.selectedSegmentNames.join(", ")
    : "All subscribed clients";

  return (
    <CampaignFlowLayout
      title="Campaign Summary"
      description="Read-only post-send campaign summary."
      topBackHref="/admin/marketing/campaigns"
      controls={
        <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5">
          <section className="rounded-md border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <h2 className="text-base font-semibold text-[#1f2735]">Summary</h2>
            <dl className="mt-3 space-y-2 text-sm text-[#334155]">
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Campaign name</dt>
                <dd>{summary.campaignName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Status</dt>
                <dd>{summary.status}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Sent at</dt>
                <dd>{formatDateTime(summary.sentAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Category</dt>
                <dd>{summary.categoryName || "No category"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">From name</dt>
                <dd>{summary.fromName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">From email</dt>
                <dd>{summary.fromEmail}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Reply-to</dt>
                <dd>{summary.replyTo || "-"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Recipients</dt>
                <dd>{summary.recipientCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Delivered</dt>
                <dd>{summary.recipientSentCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Failed</dt>
                <dd>{summary.recipientFailedCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[#5a6d86]">Pending</dt>
                <dd>{summary.recipientPendingCount}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-[#5a6d86]">Selected segments</dt>
                <dd>{selectedSegmentsLabel}</dd>
              </div>
            </dl>
          </section>
        </section>
      }
      preview={
        <CampaignPreview
          fromName={summary.fromName}
          subject={summary.subject}
          previewText={summary.previewText}
          htmlSnapshot={summary.htmlSnapshot}
        />
      }
    />
  );
}
