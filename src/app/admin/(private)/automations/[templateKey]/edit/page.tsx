import Link from "next/link";
import { redirect } from "next/navigation";

import { updateAutomationTemplateAction } from "@/app/admin/(private)/automations/actions";
import AutomationTemplateEditor from "@/components/admin/automations/AutomationTemplateEditor";
import { getAutomationTemplateDetail } from "@/lib/email/email-automation-admin-service";
import { getTokenGroupsForTemplate } from "@/lib/email/email-template-token-registry";
import { normalizeMarketingContentJson } from "@/lib/marketing/marketing-renderer";

type Params = Promise<{ templateKey: string }>;
type SearchParams = Promise<{ success?: string; error?: string }>;

export default async function AdminAutomationTemplateEditPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { templateKey } = await params;
  const sp = await searchParams;

  const detail = await getAutomationTemplateDetail(templateKey);
  if (!detail) redirect("/admin/automations");

  let blocks: unknown[] = [];
  let previewText = "";
  let emailBackgroundColor: string | undefined;
  let contentWidth: number | undefined;
  try {
    const normalized = normalizeMarketingContentJson(detail.bodyTemplateJson);
    blocks = normalized.blocks;
    previewText = normalized.previewText ?? "";
    emailBackgroundColor = normalized.emailBackgroundColor;
    contentWidth = normalized.contentWidth;
  } catch {
    // bodyTemplateJson missing or invalid - editor starts with default block
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <Link href={`/admin/automations/${templateKey}`} className="text-xs text-[#2a4f78] underline underline-offset-4">Back to {detail.name}</Link>
          <h1 className="mt-2 text-xl font-semibold text-[#1f2735]">Edit Template</h1>
          <p className="mt-0.5 font-mono text-sm text-[#5a6d86]">{templateKey}</p>
        </div>
      </header>

      <AutomationTemplateEditor
        templateKey={templateKey}
        defaultName={detail.name}
        defaultSubjectTemplate={detail.subjectTemplate}
        defaultPreviewText={previewText}
        defaultBlocks={blocks as Parameters<typeof AutomationTemplateEditor>[0]["defaultBlocks"]}
        defaultEmailBackgroundColor={emailBackgroundColor}
        defaultContentWidth={contentWidth}
        tokenGroups={getTokenGroupsForTemplate(templateKey)}
        submitAction={updateAutomationTemplateAction}
        error={sp.error}
        success={sp.success}
      />
    </section>
  );
}
