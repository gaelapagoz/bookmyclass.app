import Link from "next/link";

import { saveMarketingCampaignFlowParametersAction } from "@/app/admin/(private)/actions";
import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import CampaignRecipientPreviewPanel from "@/components/admin/marketing/CampaignRecipientPreviewPanel";
import CampaignFlowStepNavigation from "@/components/admin/marketing/CampaignFlowStepNavigation";
import CampaignPreview from "@/components/admin/marketing/CampaignPreview";
import { buildCampaignFlowScaffoldHref } from "@/components/admin/marketing/campaign-flow-scaffold-data";
import {
  getMarketingCampaignFlowDraftById,
  listMarketingCategories,
  resolveMarketingCampaignFlowRecipients,
} from "@/lib/marketing/marketing-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ page?: string; segments?: string | string[]; error?: string; success?: string }>;

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

export default async function AdminMarketingCampaignTargetPage({
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

  const [draft, categories] = await Promise.all([
    getMarketingCampaignFlowDraftById(id),
    listMarketingCategories(),
  ]);

  if (!draft) {
    return (
      <CampaignFlowLayout
        title="Campaign Parameters"
        description="Step 2 of 4: choose campaign parameters."
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
      title="Campaign Parameters"
      description="Step 2 of 4: choose campaign parameters."
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

            <label className="block text-sm text-[#334155]">
              From name
              <input name="fromName" defaultValue={draft.fromName} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
            </label>

            <label className="block text-sm text-[#334155]">
              From email
              <input
                name="fromEmail"
                type="email"
                defaultValue={draft.fromEmail || "no-reply@bookmyclass.app"}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>

            <label className="block text-sm text-[#334155]">
              Reply-to
              <input
                name="replyTo"
                type="email"
                defaultValue={draft.replyTo ?? "no-reply@bookmyclass.app"}
                className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
              />
            </label>

            <label className="block text-sm text-[#334155]">
              Category
              <select name="categoryId" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" defaultValue={draft.categoryId ?? ""}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>

            <section>
              <h2 className="text-sm font-semibold text-[#1f2735]">Segments</h2>
              <ul className="mt-2 space-y-2">
                {resolution.segmentOptions.map((segment) => {
                  const isSelected = selectedSegmentIds.includes(segment.id);
                  const updatedIds = isSelected
                    ? selectedSegmentIds.filter((segmentId) => segmentId !== segment.id)
                    : [...selectedSegmentIds, segment.id];
                  return (
                    <li key={segment.id}>
                      <Link
                        href={buildCampaignFlowScaffoldHref(id, "target", updatedIds, 1)}
                        className={`inline-flex w-full items-center justify-between rounded-full border px-3 py-2 text-sm ${
                          isSelected
                            ? "border-[#1d3652] bg-[#1d3652] text-white"
                            : "border-[#d3dbe5] bg-white text-[#1f2735]"
                        }`}
                      >
                        <span>{segment.name}</span>
                        <span className="text-xs">{isSelected ? "Selected" : "Select"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-md border border-[#d3dbe5] bg-[#f8fbff] p-4">
              <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Selected recipients</p>
              <p className="mt-1 text-2xl font-semibold text-[#1f2735]">{resolution.totalRecipients}</p>
              <p className="mt-1 text-xs text-[#5a6d86]">SUBSCRIBED clients matching selected segments (OR semantics)</p>
            </section>

            <CampaignFlowStepNavigation
              backHref={`/admin/marketing/campaigns/new?campaignId=${id}`}
              nextFormAction={saveMarketingCampaignFlowParametersAction}
            />
          </form>

          <CampaignRecipientPreviewPanel
            campaignId={id}
            step="target"
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
