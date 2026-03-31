"use client";

import { useMemo, useState } from "react";

import MarketingAiAssistPanel from "@/components/admin/marketing/MarketingAiAssistPanel";
import MarketingCampaignPreview from "@/components/admin/marketing/MarketingCampaignPreview";
import RichTextField from "@/components/admin/marketing/RichTextField";
import { sanitizeRichHtml, textToRichHtml, type RichTextVariant } from "@/lib/marketing/marketing-rich-text";

type CategoryOption = {
  id: string;
  name: string;
};

type MarketingAudienceValue = "ALL_USERS" | "ACTIVE_USERS" | "PAYING_SUBSCRIBERS" | "MANUAL";

const MARKETING_AUDIENCE = {
  ALL_USERS: "ALL_USERS",
  ACTIVE_USERS: "ACTIVE_USERS",
  PAYING_SUBSCRIBERS: "PAYING_SUBSCRIBERS",
  MANUAL: "MANUAL",
} as const satisfies Record<MarketingAudienceValue, MarketingAudienceValue>;

type HeadingBlock = { type: "heading"; contentHtml: string; text?: string };
type ParagraphBlock = { type: "paragraph"; contentHtml: string; text?: string };
type ButtonBlock = { type: "button"; labelHtml: string; url: string; text?: string };
type ImageBlock = { type: "image"; url: string; alt?: string };
type DividerBlock = { type: "divider" };
type SpacerBlock = { type: "spacer"; size: number };

type Block = HeadingBlock | ParagraphBlock | ButtonBlock | ImageBlock | DividerBlock | SpacerBlock;

type Props = {
  mode: "create" | "edit";
  campaignId?: string;
  categories: CategoryOption[];
  defaultValues?: {
    name: string;
    categoryId: string | null;
    audienceType: MarketingAudienceValue;
    manualEmails: string;
    subject: string;
    previewText: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    blocks: Block[];
  };
  submitAction: (formData: FormData) => void | Promise<void>;
  aiAction?: (formData: FormData) => void | Promise<void>;
};

const INITIAL_BLOCKS: Block[] = [
  { type: "heading", contentHtml: "<p>Campaign headline</p>" },
  { type: "paragraph", contentHtml: "<p>Add your main message here.</p>" },
  { type: "button", labelHtml: "Book now", url: "https://example.com" },
];

function normalizeBlockForEditor(block: Block): Block {
  if (block.type === "heading") {
    return {
      ...block,
      contentHtml: sanitizeRichHtml(block.contentHtml || textToRichHtml(block.text ?? "", "heading"), "heading"),
    };
  }

  if (block.type === "paragraph") {
    return {
      ...block,
      contentHtml: sanitizeRichHtml(block.contentHtml || textToRichHtml(block.text ?? "", "paragraph"), "paragraph"),
    };
  }

  if (block.type === "button") {
    return {
      ...block,
      labelHtml: sanitizeRichHtml(block.labelHtml || textToRichHtml(block.text ?? "", "button"), "button"),
      url: block.url || "https://example.com",
    };
  }

  return block;
}

function buildNewBlock(type: Block["type"]): Block {
  if (type === "heading") {
    return { type: "heading", contentHtml: "<p>New heading</p>" };
  }
  if (type === "paragraph") {
    return { type: "paragraph", contentHtml: "<p>New paragraph</p>" };
  }
  if (type === "button") {
    return { type: "button", labelHtml: "Button", url: "https://example.com" };
  }
  if (type === "image") {
    return { type: "image", url: "https://example.com/image.jpg", alt: "" };
  }
  if (type === "divider") {
    return { type: "divider" };
  }
  return { type: "spacer", size: 24 };
}

function variantFromBlock(block: Block): RichTextVariant {
  if (block.type === "heading") {
    return "heading";
  }
  if (block.type === "paragraph") {
    return "paragraph";
  }
  return "button";
}

export default function MarketingCampaignForm({
  mode,
  campaignId,
  categories,
  defaultValues,
  submitAction,
  aiAction,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(
    defaultValues?.blocks?.length ? defaultValues.blocks.map((block) => normalizeBlockForEditor(block)) : INITIAL_BLOCKS,
  );
  const [manualEmails, setManualEmails] = useState(defaultValues?.manualEmails ?? "");

  const contentJson = useMemo(() => JSON.stringify({ blocks }), [blocks]);
  const manualAudienceJson = useMemo(() => {
    const emails = manualEmails
      .split(/\r?\n|,/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return JSON.stringify({ emails: [...new Set(emails)], userIds: [] });
  }, [manualEmails]);

  const updateBlock = (index: number, patch: Partial<Block>) => {
    setBlocks((previous) => previous.map((item, idx) => (idx === index ? ({ ...item, ...patch } as Block) : item)));
  };

  const addBlock = (type: Block["type"]) => {
    setBlocks((previous) => [...previous, buildNewBlock(type)]);
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
      <form action={submitAction} className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5">
        {campaignId ? <input type="hidden" name="campaignId" value={campaignId} /> : null}
        <input type="hidden" name="contentJson" value={contentJson} />
        <input type="hidden" name="manualAudienceJson" value={manualAudienceJson} />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Campaign name
            <input name="name" required defaultValue={defaultValues?.name ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Category
            <select name="categoryId" defaultValue={defaultValues?.categoryId ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-sm text-[#334155]">
            Audience
            <select name="audienceType" defaultValue={defaultValues?.audienceType ?? MARKETING_AUDIENCE.ALL_USERS} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2">
              <option value={MARKETING_AUDIENCE.ALL_USERS}>All users</option>
              <option value={MARKETING_AUDIENCE.ACTIVE_USERS}>Active users</option>
              <option value={MARKETING_AUDIENCE.PAYING_SUBSCRIBERS}>Paying subscribers</option>
              <option value={MARKETING_AUDIENCE.MANUAL}>Manual emails</option>
            </select>
          </label>
          <label className="block text-sm text-[#334155]">
            Manual emails (optional)
            <textarea value={manualEmails} onChange={(event) => setManualEmails(event.target.value)} rows={3} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <label className="block text-sm text-[#334155]">
          Subject
          <input name="subject" required defaultValue={defaultValues?.subject ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <label className="block text-sm text-[#334155]">
          Preview text
          <input name="previewText" required defaultValue={defaultValues?.previewText ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
        </label>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-sm text-[#334155]">
            From name
            <input name="fromName" required defaultValue={defaultValues?.fromName ?? "Studio Team"} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            From email
            <input name="fromEmail" type="email" required defaultValue={defaultValues?.fromEmail ?? "studio@example.com"} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
          <label className="block text-sm text-[#334155]">
            Reply-to
            <input name="replyTo" type="email" defaultValue={defaultValues?.replyTo ?? ""} className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2" />
          </label>
        </div>

        <section className="rounded-md border border-[#e2e8f0] p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#1f2735]">Content blocks</h3>
            <div className="flex flex-wrap gap-1">
              {(["heading", "paragraph", "button", "image", "divider", "spacer"] as const).map((type) => (
                <button key={type} type="button" onClick={() => addBlock(type)} className="rounded border border-[#d3dbe5] px-2 py-1 text-xs hover:bg-[#f3f6fb]">+ {type}</button>
              ))}
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {blocks.map((block, index) => (
              <div key={`${block.type}-${index}`} className="rounded border border-[#e2e8f0] bg-[#f8fbff] p-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">{block.type}</p>
                {block.type === "heading" || block.type === "paragraph" ? (
                  <RichTextField
                    value={block.contentHtml}
                    variant={variantFromBlock(block)}
                    onChange={(html) => updateBlock(index, { contentHtml: html } as Partial<Block>)}
                  />
                ) : null}
                {block.type === "button" ? (
                  <div className="mt-1 grid gap-2 md:grid-cols-2">
                    <RichTextField
                      value={block.labelHtml}
                      variant="button"
                      onChange={(html) => updateBlock(index, { labelHtml: html } as Partial<Block>)}
                    />
                    <input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value } as Partial<Block>)} className="rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                  </div>
                ) : null}
                {block.type === "image" ? (
                  <div className="mt-1 grid gap-2 md:grid-cols-2">
                    <input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value } as Partial<Block>)} className="rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                    <input value={block.alt ?? ""} onChange={(event) => updateBlock(index, { alt: event.target.value } as Partial<Block>)} className="rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                  </div>
                ) : null}
                {block.type === "spacer" ? (
                  <input type="number" min={8} max={80} value={block.size} onChange={(event) => updateBlock(index, { size: Number(event.target.value) } as Partial<Block>)} className="mt-1 w-32 rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                ) : null}
                <div className="mt-2">
                  <button type="button" onClick={() => setBlocks((prev) => prev.filter((_, idx) => idx !== index))} className="text-xs text-[#7b2d2d] underline">Remove block</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <button type="submit" className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
          {mode === "create" ? "Save draft" : "Update draft"}
        </button>
      </form>

      <div className="space-y-4">
        <MarketingCampaignPreview blocksJson={contentJson} />
        {campaignId && aiAction ? (
          <MarketingAiAssistPanel campaignId={campaignId} action={aiAction} />
        ) : (
          <section className="rounded-xl border border-[#d3dbe5] bg-white p-4 text-sm text-[#4b5a72]">
            Save the draft first to enable AI Assist.
          </section>
        )}
      </div>
    </div>
  );
}

