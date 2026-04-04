import Link from "next/link";

import {
  saveMarketingCampaignFlowDraftAction,
} from "@/app/admin/(private)/actions";
import CampaignFlowStep1BlocksForm from "@/components/admin/marketing/CampaignFlowStep1BlocksForm";
import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import {
  getMarketingCampaignFlowDraftById,
} from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{
  campaignId?: string;
  campaignName?: string;
  subject?: string;
  previewText?: string;
  success?: string;
  error?: string;
}>;

export default async function AdminMarketingCampaignCreatePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { campaignId, campaignName, subject, previewText, success, error } = await searchParams;
  const draft = campaignId ? await getMarketingCampaignFlowDraftById(campaignId) : null;
  const nextHref = draft ? `/admin/marketing/campaigns/${draft.id}/target` : undefined;

  return (
    <CampaignFlowLayout
      title="Create Campaign"
      description="Step 1 of 4: set campaign basics and save draft content."
      topBackHref="/admin/marketing/campaigns"
      controls={
        <>
          <CampaignFlowStep1BlocksForm
            campaignId={draft?.id}
            nextHref={nextHref}
            submitAction={saveMarketingCampaignFlowDraftAction}
            error={error}
            success={success}
            defaultValues={{
              campaignName: draft?.name ?? campaignName ?? "",
              subject: draft?.subject ?? subject ?? "",
              previewText: draft?.previewText ?? previewText ?? "",
              blocks: Array.isArray((draft?.contentJson as { blocks?: unknown } | null)?.blocks)
                ? ((draft?.contentJson as { blocks: unknown[] }).blocks as never[])
                : [],
              imageAssetUrl: draft?.imageAssetUrl ?? null,
            }}
          />
          <p className="text-sm text-[#4b5a72]">
            Need the existing creator?
            {" "}
            <Link href="/admin/marketing/campaigns/new/legacy" className="text-[#2a4f78] underline underline-offset-4">
              Open legacy campaign form
            </Link>
            .
          </p>
        </>
      }
      preview={<CampaignPreview fromName={draft?.fromName} subject={draft?.subject} previewText={draft?.previewText} htmlSnapshot={draft?.htmlSnapshot} />}
    />
  );
}
