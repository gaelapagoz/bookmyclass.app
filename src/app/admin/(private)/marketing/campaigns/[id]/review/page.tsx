import {
  moveMarketingCampaignFlowToConfirmAction,
  sendMarketingCampaignFlowTestEmailAction,
} from "@/app/admin/(private)/actions";
import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignRecipientPreviewPanel from "@/components/admin/marketing/CampaignRecipientPreviewPanel";
import CampaignFlowStepNavigation from "@/components/admin/marketing/CampaignFlowStepNavigation";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import { buildCampaignFlowScaffoldHref } from "@/components/admin/marketing/campaign-flow-scaffold-data";
import { getMarketingCampaignFlowDraftById, resolveMarketingCampaignFlowRecipients } from "@/lib/marketing/marketing-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{
  segments?: string | string[];
  page?: string;
  testEmail?: string;
  success?: string;
  error?: string;
}>;

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

export default async function AdminMarketingCampaignReviewPage({
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
        title="Review Campaign"
        description="Step 3 of 4: review full campaign summary before final confirmation."
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
  const selectedSegmentsLabel = selectedSegmentIds.length
    ? resolution.segmentOptions.filter((segment) => selectedSegmentIds.includes(segment.id)).map((segment) => segment.name).join(", ")
    : "All subscribed clients";

  return (
    <CampaignFlowLayout
      title="Review Campaign"
      description="Step 3 of 4: review full campaign summary before final confirmation."
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
              <h2 className="text-sm font-semibold text-[#1f2735]">Summary</h2>
              <dl className="mt-3 space-y-2 text-sm text-[#334155]">
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Campaign name</dt>
                  <dd>{draft.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Subject</dt>
                  <dd>{draft.subject}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Preview text</dt>
                  <dd>{draft.previewText}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">From name</dt>
                  <dd>{draft.fromName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">From email</dt>
                  <dd>{draft.fromEmail}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Reply-to</dt>
                  <dd>{draft.replyTo || "-"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Category</dt>
                  <dd>{draft.categoryName || "No category"}</dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-[#5a6d86]">Selected segments</dt>
                  <dd>{selectedSegmentsLabel}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[#5a6d86]">Selected recipient count</dt>
                  <dd>{resolution.totalRecipients}</dd>
                </div>
              </dl>
            </section>

            <section className="rounded-md border border-[#e2e8f0] bg-[#f8fbff] p-4">
              <label className="block text-sm text-[#334155]">
                Test email address
                <input
                  name="toEmail"
                  type="email"
                  defaultValue={resolvedSearchParams.testEmail ?? draft.replyTo ?? draft.fromEmail}
                  className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <button
                type="submit"
                formAction={sendMarketingCampaignFlowTestEmailAction}
                className="mt-3 rounded border border-[#d3dbe5] px-4 py-2 text-sm text-[#1f2735]"
              >
                Send test email
              </button>
            </section>

            <CampaignFlowStepNavigation
              backHref={buildCampaignFlowScaffoldHref(id, "target", selectedSegmentIds, resolution.page)}
              nextFormAction={moveMarketingCampaignFlowToConfirmAction}
            />
          </form>
          <CampaignRecipientPreviewPanel
            campaignId={id}
            step="review"
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
