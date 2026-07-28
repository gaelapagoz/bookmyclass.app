import Link from "next/link";

import { saveMarketingCampaignFlowContentAction } from "@/app/admin/(private)/actions";
import AutomationTemplateEditor from "@/components/admin/automations/AutomationTemplateEditor";
import CampaignFlowLayout from "@/components/admin/marketing/CampaignFlowLayout";
import { getTokenGroupsForTemplate } from "@/lib/email/email-template-token-registry";
import { normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";
import { getMarketingCampaignFlowDraftById } from "@/lib/marketing/marketing-service";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

export default async function AdminMarketingCampaignTargetPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const draft = await getMarketingCampaignFlowDraftById(id);
  const normalizedContent = draft ? normalizeMarketingContentJson(draft.contentJson) : null;

  if (!draft) {
    return (
      <CampaignFlowLayout
        title="Edit Email"
        description="Step 2 of 4: design the email your recipients will see."
        topBackHref="/admin/campaigns"
        controls={<section className="rounded-xl border border-[#d3dbe5] bg-white p-5 text-sm text-[#7b2d2d]">Campaign draft not found.</section>}
        preview={<div />}
      />
    );
  }

  async function submit(formData: FormData) {
    "use server";
    formData.set("campaignId", id);
    await saveMarketingCampaignFlowContentAction(formData);
  }

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Email</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Step 2 of 4: design the email your recipients will see.</p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#1f2735]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ddf4e5] text-xs font-semibold text-[#137333]">✓</span>
              <span className="font-semibold">Basics</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#1d3652] bg-[#e9f1fb] px-3 py-1 font-semibold text-[#1d3652]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#1d3652] text-xs font-semibold text-white">2</span>
              <span>Email</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#5a6d86]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#eef3f9] text-xs font-semibold text-[#5a6d86]">3</span>
              <span>Review</span>
            </span>
            <span className="text-[#9aa8bc]">-</span>
            <span className="inline-flex items-center gap-2 rounded-full border border-[#d3dbe5] bg-[#f8fbff] px-3 py-1 text-[#5a6d86]">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#eef3f9] text-xs font-semibold text-[#5a6d86]">4</span>
              <span>Confirm</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/admin/campaigns/new?campaignId=${id}`} className="rounded border border-[#d3dbe5] bg-white px-4 py-2 text-sm text-[#1f2735]">Back</Link>
          <button type="submit" form="marketing-step-2-form" name="intent" value="next" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm font-semibold text-white">Next</button>
          <button type="submit" form="marketing-step-2-form" name="intent" value="save" className="rounded-md border border-[#d3dbe5] bg-white px-4 py-2 text-sm text-[#1f2735]">Save draft</button>
        </div>
      </header>

      <AutomationTemplateEditor
        formId="marketing-step-2-form"
        hideTopToolbar
        templateKey="marketing.campaign"
        defaultName={draft.name}
        defaultSubjectTemplate={draft.subject}
        defaultPreviewText={draft.previewText}
        defaultBlocks={(normalizedContent?.blocks ?? []) as Parameters<typeof AutomationTemplateEditor>[0]["defaultBlocks"]}
        tokenGroups={getTokenGroupsForTemplate("marketing.campaign")}
        submitAction={submit}
        error={error}
        success={success ? "1" : undefined}
      />
    </section>
  );
}
