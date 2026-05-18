import Link from "next/link";

import { saveMarketingCampaignFlowDraftAction } from "@/app/admin/(private)/actions";
import CampaignRecipientPreviewPanel from "@/components/admin/marketing/CampaignRecipientPreviewPanel";
import {
  getMarketingCampaignFlowDraftById,
  listMarketingCategories,
  listMarketingSegments,
  resolveMarketingCampaignFlowRecipients,
} from "@/lib/marketing/marketing-service";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  campaignId?: string;
  campaignName?: string;
  subject?: string;
  previewText?: string;
  page?: string;
  segments?: string | string[];
  success?: string;
  error?: string;
}>;

function toArrayParam(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toPageParam(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export default async function AdminMarketingCampaignCreatePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const draft = sp.campaignId ? await getMarketingCampaignFlowDraftById(sp.campaignId) : null;
  const selectedSegmentIdsFromQuery = toArrayParam(sp.segments);
  const [categories, allSegments, resolution] = draft
    ? await Promise.all([
      listMarketingCategories(),
      listMarketingSegments(),
      resolveMarketingCampaignFlowRecipients({
        campaignId: draft.id,
        selectedSegmentIds: selectedSegmentIdsFromQuery.length ? selectedSegmentIdsFromQuery : draft.selectedSegmentIds,
        page: toPageParam(sp.page),
      }),
    ])
    : [await listMarketingCategories(), await listMarketingSegments(), null];

  const selectedSegmentIds = resolution?.selectedSegmentIds ?? selectedSegmentIdsFromQuery;
  const segmentOptions = resolution?.segmentOptions ?? allSegments.filter((segment) => segment.isActive).map((segment) => ({
    id: segment.id,
    name: segment.name,
  }));
  const nextHref = draft ? `/admin/marketing/campaigns/${draft.id}/target` : undefined;
  const selectedCount = resolution?.totalRecipients ?? 0;

  async function submit(formData: FormData) {
    "use server";
    await saveMarketingCampaignFlowDraftAction(formData);
  }

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Create Campaign</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Step 1 of 4: set campaign basics and save draft metadata.</p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="rounded-full border border-[#1d3652] bg-[#e9f1fb] px-3 py-1 font-semibold text-[#1d3652]">1 Basics</span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#5a6d86]">2 Email</span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#5a6d86]">3 Review</span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#5a6d86]">4 Confirm</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nextHref ? <Link href={nextHref} className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white">Next</Link> : null}
          <button type="submit" form="campaign-step-1-form" className="rounded-md border border-[#d3dbe5] bg-white px-4 py-2 text-sm text-[#1f2735]">Save draft</button>
        </div>
      </header>

      <form id="campaign-step-1-form" className="grid gap-4 xl:grid-cols-3" action={submit}>
        <input type="hidden" name="campaignId" value={draft?.id ?? ""} />
        <input type="hidden" name="page" value={String(resolution?.page ?? 1)} />
        {selectedSegmentIds.map((segmentId) => (
          <input key={segmentId} type="hidden" name="segments" value={segmentId} />
        ))}

        <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5 xl:col-span-1">
          <h2 className="text-lg font-semibold text-[#1f2735]">Campaign basics</h2>
          {sp.error ? <p className="text-sm text-[#7b2d2d]">{sp.error}</p> : null}
          {sp.success ? <p className="text-sm text-[#166534]">{sp.success}</p> : null}
          <label className="block text-sm text-[#334155]">Campaign name
            <input name="campaignName" defaultValue={draft?.name ?? sp.campaignName ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" required />
          </label>
          <label className="block text-sm text-[#334155]">Subject
            <input name="subject" defaultValue={draft?.subject ?? sp.subject ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" required />
          </label>
          <label className="block text-sm text-[#334155]">Preview text
            <input name="previewText" defaultValue={draft?.previewText ?? sp.previewText ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" required />
          </label>
          <label className="block rounded-md border border-dashed border-[#d3dbe5] bg-[#f8fbff] px-3 py-4 text-sm text-[#5a6d86]">
            Campaign image (optional)
            <input type="file" name="campaignImage" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm text-[#334155]" />
            <span className="mt-1 block text-xs">PNG or JPG, up to 5 MB</span>
          </label>
        </section>

        <section className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5 xl:col-span-1">
          <h2 className="text-lg font-semibold text-[#1f2735]">Campaign parameters</h2>
          <label className="block text-sm text-[#334155]">From name
            <input name="fromName" defaultValue={draft?.fromName ?? "Studio Team"} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" required />
          </label>
          <label className="block text-sm text-[#334155]">From email
            <input name="fromEmail" type="email" defaultValue={draft?.fromEmail ?? "no-reply@bookmyclass.app"} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" required />
          </label>
          <label className="block text-sm text-[#334155]">Reply-to
            <input name="replyTo" type="email" defaultValue={draft?.replyTo ?? "no-reply@bookmyclass.app"} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">Category
            <select name="categoryId" className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" defaultValue={draft?.categoryId ?? ""}>
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <section>
            <h3 className="text-sm font-semibold text-[#1f2735]">Segments</h3>
            <ul className="mt-2 space-y-2">
              {segmentOptions.map((segment) => {
                const isSelected = selectedSegmentIds.includes(segment.id);
                const updatedIds = isSelected
                  ? selectedSegmentIds.filter((segmentId) => segmentId !== segment.id)
                  : [...selectedSegmentIds, segment.id];
                const qs = new URLSearchParams();
                if (draft?.id) qs.set("campaignId", draft.id);
                updatedIds.forEach((segmentId) => qs.append("segments", segmentId));
                qs.set("page", "1");
                return (
                  <li key={segment.id}>
                    <Link
                      href={`/admin/marketing/campaigns/new?${qs.toString()}`}
                      className={`inline-flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm ${isSelected ? "border-[#1d3652] bg-[#e9f1fb] text-[#1d3652]" : "border-[#d3dbe5] bg-white text-[#1f2735]"}`}
                    >
                      <span>{segment.name}</span>
                      <span className="text-xs">{isSelected ? "Remove" : "Select"}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </section>

        <div className="space-y-4 xl:col-span-1">
          <section className="rounded-xl border border-[#d3dbe5] bg-white p-5">
            <p className="text-xs uppercase tracking-wide text-[#5a6d86]">Selected recipients</p>
            <p className="mt-1 text-4xl font-semibold text-[#8a2f2f]">{selectedCount}</p>
            <p className="mt-2 text-xs text-[#5a6d86]">Subscribed clients matching selected segments (OR semantics)</p>
            <p className="mt-1 text-xs text-[#5a6d86]">Clients with Never subscribed or Unsubscribed are excluded.</p>
            {selectedCount < 1 ? (
              <p className="mt-3 rounded-md border border-[#f2b6b6] bg-[#fdecec] px-3 py-2 text-sm text-[#8a2f2f]">
                No subscribed recipients match - adjust segments before sending.
              </p>
            ) : null}
          </section>
          <CampaignRecipientPreviewPanel
            campaignId={draft?.id ?? "new"}
            step="target"
            selectedSegmentIds={selectedSegmentIds}
            currentPage={resolution?.page ?? 1}
            totalPages={resolution?.totalPages ?? 1}
            totalRecipients={selectedCount}
            recipients={resolution?.recipients ?? []}
          />
        </div>
      </form>
    </section>
  );
}
