import { markMarketingCampaignFlowSentAction } from "@/app/admin/(private)/actions";
import CampaignRecipientPreviewPanel from "@/components/admin/marketing/CampaignRecipientPreviewPanel";
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
      <section className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-[#1f2735]">Confirm Campaign</h1>
            <p className="mt-1 text-sm text-[#4b5a72]">Step 4 of 4: final confirmation before send.</p>
          </div>
        </header>
        <section className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#7b2d2d]">Campaign draft not found.</section>
      </section>
    );
  }

  const resolution = await resolveMarketingCampaignFlowRecipients({
    campaignId: id,
    selectedSegmentIds: querySegmentIds.length ? querySegmentIds : draft.selectedSegmentIds,
    page: currentPage,
    pageSize: 20,
  });
  const selectedSegmentIds = resolution.selectedSegmentIds;

  const reviewHref = buildCampaignFlowScaffoldHref(id, "review", selectedSegmentIds, resolution.page);
  const draftSavedHref = `${buildCampaignFlowScaffoldHref(id, "confirm", selectedSegmentIds, resolution.page)}&success=${encodeURIComponent("Draft saved.")}`;
  const sendDisabled = resolution.totalRecipients <= 0;

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Confirm Campaign</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Step 4 of 4: final confirmation before send.</p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#1f2735]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ddf4e5] text-xs font-semibold text-[#137333]">✓</span>
              <span className="font-semibold">Basics</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#1f2735]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ddf4e5] text-xs font-semibold text-[#137333]">✓</span>
              <span className="font-semibold">Email</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#1f2735]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ddf4e5] text-xs font-semibold text-[#137333]">✓</span>
              <span className="font-semibold">Review</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#1d3652] bg-[#e9f1fb] px-3 py-1 font-semibold text-[#1d3652]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1d3652] text-xs font-semibold text-white">4</span>
              <span>Confirm</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={reviewHref} className="rounded border border-[#d3dbe5] bg-white px-4 py-2 text-sm text-[#1f2735]">Back</a>
          <a href={draftSavedHref} className="rounded-md border border-[#d3dbe5] bg-white px-4 py-2 text-sm text-[#1f2735]">Save draft</a>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
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
              {sendDisabled ? (
                <p className="mt-3 rounded border border-[#f3c5c5] bg-[#fae3e3] px-3 py-2 text-sm text-[#7b2d2d]">
                  Warning: sending will be disabled until at least one recipient matches.
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  formAction={markMarketingCampaignFlowSentAction}
                  disabled={sendDisabled}
                  className="rounded-md bg-[#1d3652] px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-[#7c8da3]"
                >
                  Send campaign
                </button>
              </div>
            </section>
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
        </div>
        <div className="min-h-[620px] lg:col-span-2">
          <CampaignPreview fromName={draft.fromName} subject={draft.subject} previewText={draft.previewText} htmlSnapshot={draft.htmlSnapshot} />
        </div>
      </div>
    </section>
  );
}
