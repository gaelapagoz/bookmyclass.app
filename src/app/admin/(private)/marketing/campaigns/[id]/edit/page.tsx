import Link from "next/link";
import { notFound } from "next/navigation";

import {
  generateMarketingCampaignAiDraftAction,
  sendMarketingCampaignNowAction,
  sendMarketingCampaignTestAction,
  updateMarketingCampaignDraftAction,
} from "@/app/admin/(private)/actions";
import MarketingCampaignForm from "@/components/admin/marketing/MarketingCampaignForm";
import { getMarketingCampaignById, listMarketingCategories } from "@/lib/marketing/marketing-service";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; success?: string }>;

function parseBlocks(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const blocks = (input as { blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) {
    return [];
  }

  return blocks.map((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      return block;
    }

    const typed = block as Record<string, unknown>;
    if (typed.type === "heading") {
      const contentHtml = String(typed.contentHtml ?? "").trim();
      const text = String(typed.text ?? "").trim();
      return {
        ...typed,
        contentHtml: contentHtml || (text ? `<p>${text}</p>` : "<p></p>"),
      };
    }

    if (typed.type === "paragraph") {
      const contentHtml = String(typed.contentHtml ?? "").trim();
      const text = String(typed.text ?? "").trim();
      return {
        ...typed,
        contentHtml: contentHtml || (text ? `<p>${text}</p>` : "<p></p>"),
      };
    }

    if (typed.type === "button") {
      const labelHtml = String(typed.labelHtml ?? "").trim();
      const text = String(typed.text ?? "").trim();
      return {
        ...typed,
        labelHtml: labelHtml || text || "",
      };
    }

    return typed;
  });
}

export default async function AdminMarketingCampaignEditPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;

  const [campaign, categories] = await Promise.all([getMarketingCampaignById(id), listMarketingCategories()]);

  if (!campaign) {
    notFound();
  }

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">Edit Campaign</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">Status: {campaign.status}</p>
        </div>
        <Link href="/admin/marketing/campaigns" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to campaigns
        </Link>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#166534]">{success}</p> : null}

      <MarketingCampaignForm
        mode="edit"
        campaignId={campaign.id}
        categories={categories.map((category) => ({ id: category.id, name: category.name }))}
        defaultValues={{
          name: campaign.name,
          categoryId: campaign.categoryId,
          audienceType: campaign.audienceType,
          manualEmails: Array.isArray((campaign.manualAudienceJson as { emails?: unknown } | null)?.emails)
            ? ((campaign.manualAudienceJson as { emails: unknown[] }).emails.map(String).join("\n"))
            : "",
          subject: campaign.subject,
          previewText: campaign.previewText,
          fromName: campaign.fromName,
          fromEmail: campaign.fromEmail,
          replyTo: campaign.replyTo ?? "",
          blocks: parseBlocks(campaign.contentJson) as never,
        }}
        submitAction={updateMarketingCampaignDraftAction}
        aiAction={generateMarketingCampaignAiDraftAction}
      />

      <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <h3 className="text-base font-semibold text-[#1f2735]">Delivery</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={sendMarketingCampaignTestAction} className="flex items-center gap-2">
            <input type="hidden" name="campaignId" value={campaign.id} />
            <input name="toEmail" type="email" placeholder="test@email.com" className="rounded-md border border-[#d3dbe5] px-3 py-1.5 text-sm" />
            <button type="submit" className="rounded border border-[#d3dbe5] px-3 py-1.5 text-sm">Send test</button>
          </form>

          <form action={sendMarketingCampaignNowAction}>
            <input type="hidden" name="campaignId" value={campaign.id} />
            <button type="submit" className="rounded-md bg-[#1d3652] px-3 py-1.5 text-sm text-white">Send now</button>
          </form>
        </div>
      </section>
    </section>
  );
}
