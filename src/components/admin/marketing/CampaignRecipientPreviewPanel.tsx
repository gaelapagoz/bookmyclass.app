import Link from "next/link";

import { buildCampaignFlowScaffoldHref } from "@/components/admin/marketing/campaign-flow-scaffold-data";
import type { MarketingCampaignFlowRecipient } from "@/lib/marketing/marketing-service";

type CampaignRecipientPreviewPanelProps = {
  campaignId: string;
  step: "target" | "review" | "confirm";
  selectedSegmentIds: string[];
  currentPage: number;
  totalPages: number;
  totalRecipients: number;
  recipients: MarketingCampaignFlowRecipient[];
};

export default function CampaignRecipientPreviewPanel({
  campaignId,
  step,
  selectedSegmentIds,
  currentPage,
  totalPages,
  totalRecipients,
  recipients,
}: CampaignRecipientPreviewPanelProps) {
  const clampedPage = Math.min(Math.max(currentPage, 1), totalPages);

  return (
    <section className="space-y-3 rounded-xl border border-[#d3dbe5] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#1f2735]">Recipient preview</h2>
        <p className="text-xs text-[#5a6d86]">Resolved on server</p>
      </div>
      {!recipients.length ? (
        <p className="rounded-md border border-dashed border-[#d3dbe5] bg-[#f8fbff] px-3 py-4 text-sm text-[#5a6d86]">
          No subscribed recipients match the current targeting.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-[#e2e8f0] rounded-md border border-[#e2e8f0]">
            {recipients.map((recipient) => (
              <li key={recipient.id} className="space-y-1 px-3 py-2">
                <p className="text-sm font-medium text-[#1f2735]">{recipient.name}</p>
                <p className="text-sm text-[#4b5a72]">{recipient.email}</p>
                <p className="text-xs text-[#5a6d86]">
                  Subscription: {recipient.marketingSubscriptionStatus.replaceAll("_", " ").toLowerCase()}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#5a6d86]">{totalRecipients} total recipients</p>
          <div className="flex items-center justify-between gap-3 text-sm">
            <p className="text-[#4b5a72]">
              Page {clampedPage} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              {clampedPage > 1 ? (
                <Link
                  href={buildCampaignFlowScaffoldHref(campaignId, step, selectedSegmentIds, clampedPage - 1)}
                  className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#1f2735]"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded border border-[#e2e8f0] px-3 py-1.5 text-sm text-[#94a3b8]">Previous</span>
              )}
              {clampedPage < totalPages ? (
                <Link
                  href={buildCampaignFlowScaffoldHref(campaignId, step, selectedSegmentIds, clampedPage + 1)}
                  className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm text-[#1f2735]"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded border border-[#e2e8f0] px-3 py-1.5 text-sm text-[#94a3b8]">Next</span>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
