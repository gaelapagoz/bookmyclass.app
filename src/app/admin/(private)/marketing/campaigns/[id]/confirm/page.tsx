import { markMarketingCampaignFlowSentAction } from "@/app/admin/(private)/actions";
import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignRecipientPreviewPanel from "@/components/admin/marketing/CampaignRecipientPreviewPanel";
import CampaignFlowStepNavigation from "@/components/admin/marketing/CampaignFlowStepNavigation";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import { buildCampaignFlowScaffoldHref } from "@/components/admin/marketing/campaign-flow-scaffold-data";
import { getMarketingCampaignFlowDraftById, resolveMarketingCampaignFlowRecipients } from "@/lib/marketing/marketing-service";
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ segments?: string | string[]; page?: string; error?: string; success?: string }>;

function toArrayParam(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function toPageParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminMarketingCampaignConfirmPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const querySegmentIds = toArrayParam(resolvedSearchParams.segments);
  const currentPage = toPageParam(resolvedSearchParams.page);
  const draft = await getMarketingCampaignFlowDraftById(id);

  if (!draft) {
    return (
      <CampaignFlowLayout
        title="Confirm Campaign"
        description="Step 4 of 4: final confirmation before send."
        topBackHref="/admin/marketing/campaigns"
        controls={<section className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#7b2d2d]">Campaign draft not found.</section>}
        preview={<CampaignPreview />}
      />
    );
  }

  const resolution = await resolveMarketingCampaignFlowRecipients({
    campaignId: id,
    selectedSegmentIds: querySegmentIds.length ? querySegmentIds : draft.selectedSegmentIds,
    page: currentPage,
    pageSize: 20,
  });
  const selectedSegmentIds = resolution.selectedSegmentIds;

  return (
    <CampaignFlowLayout
      title="Confirm Campaign"
      description="Step 4 of 4: final confirmation before send."
      topBackHref="/admin/marketing/campaigns"
      controls={
        <>
          <form className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5">
            {resolvedSearchParams.error ? <p className="text-sm text-[#7b2d2d]">{resolvedSearchParams.error}</p> : null}
            {resolvedSearchParams.success ? <p className="text-sm text-[#166534]">{resolvedSearchParams.success}</p> : null}

            <input type="hidden" name="campaignId" value={id} />
            <input type="hidden" name="page" value={String(resolution.page)} />
            {selectedSegmentIds.map((segmentId) => (
              <input key={segmentId} type="hidden" name="segments" value={segmentId} />
            ))}

            <section className="rounded-md border border-[#e2e8f0] bg-[#f8fbff] p-4">
              <h2 className="text-base font-semibold text-[#1f2735]">Ready to send</h2>
              <p className="mt-2 text-sm text-[#4b5a72]">
                {resolution.totalRecipients} subscribed recipients are selected based on your segment targeting.
              </p>
            </section>

            <CampaignFlowStepNavigation
              backHref={buildCampaignFlowScaffoldHref(id, "review", selectedSegmentIds, resolution.page)}
              backLabel="Back to review"
              nextFormAction={markMarketingCampaignFlowSentAction}
              nextLabel="Send campaign"
            />
          </form>
          <CampaignRecipientPreviewPanel
            campaignId={id}
            step="confirm"
            selectedSegmentIds={selectedSegmentIds}
            currentPage={resolution.page}
            totalPages={resolution.totalPages}
            totalRecipients={resolution.totalRecipients}
            recipients={resolution.recipients}
          />
        </>
      }
      preview={<CampaignPreview fromName={draft.fromName} subject={draft.subject} previewText={draft.previewText} htmlSnapshot={draft.htmlSnapshot} />}
    />
  );
}
