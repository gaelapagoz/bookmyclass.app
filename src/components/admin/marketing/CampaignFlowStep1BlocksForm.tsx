"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import ColorPalettePopover from "@/components/admin/marketing/ColorPalettePopover";
import RichTextField from "@/components/admin/marketing/RichTextField";
import { sanitizeRichHtml, textToRichHtml, type RichTextVariant } from "@/lib/marketing/marketing-rich-text";

type HeadingBlock = { type: "heading"; contentHtml: string; text?: string; textColor?: string };
type ParagraphBlock = { type: "paragraph"; contentHtml: string; text?: string; textColor?: string };
type ButtonBlock = { type: "button"; labelHtml: string; url: string; text?: string; textColor?: string; backgroundColor?: string };
type ImageBlock = { type: "image"; url: string; alt?: string };
type DividerBlock = { type: "divider" };
type SpacerBlock = { type: "spacer"; size: number };

type Block = HeadingBlock | ParagraphBlock | ButtonBlock | ImageBlock | DividerBlock | SpacerBlock;

type Props = {
  campaignId?: string;
  nextHref?: string;
  defaultValues: {
    campaignName: string;
    subject: string;
    previewText: string;
    blocks: Block[];
    imageAssetUrl: string | null;
  };
  submitAction: (formData: FormData) => void | Promise<void>;
  error?: string;
  success?: string;
};

const INITIAL_BLOCKS: Block[] = [
  { type: "heading", contentHtml: "<p>Campaign headline</p>", textColor: "#1f2735" },
  { type: "paragraph", contentHtml: "<p>Add your main message here.</p>", textColor: "#334155" },
  { type: "button", labelHtml: "Book now", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" },
];

const COLOR_PRESETS = ["#1d3652", "#1f2735", "#334155", "#0f766e", "#2563eb", "#7c3aed", "#b91c1c", "#ffffff"] as const;

function normalizeBlockForEditor(block: Block): Block {
  if (block.type === "heading") {
    return {
      ...block,
      contentHtml: sanitizeRichHtml(block.contentHtml || textToRichHtml(block.text ?? "", "heading"), "heading"),
      textColor: block.textColor || "#1f2735",
    };
  }

  if (block.type === "paragraph") {
    return {
      ...block,
      contentHtml: sanitizeRichHtml(block.contentHtml || textToRichHtml(block.text ?? "", "paragraph"), "paragraph"),
      textColor: block.textColor || "#334155",
    };
  }

  if (block.type === "button") {
    return {
      ...block,
      labelHtml: sanitizeRichHtml(block.labelHtml || textToRichHtml(block.text ?? "", "button"), "button"),
      url: block.url || "https://example.com",
      textColor: block.textColor || "#ffffff",
      backgroundColor: block.backgroundColor || "#1d3652",
    };
  }

  return block;
}

function buildNewBlock(type: Block["type"]): Block {
  if (type === "heading") {
    return { type: "heading", contentHtml: "<p>New heading</p>", textColor: "#1f2735" };
  }
  if (type === "paragraph") {
    return { type: "paragraph", contentHtml: "<p>New paragraph</p>", textColor: "#334155" };
  }
  if (type === "button") {
    return { type: "button", labelHtml: "Button", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" };
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

export default function CampaignFlowStep1BlocksForm({
  campaignId,
  nextHref,
  defaultValues,
  submitAction,
  error,
  success,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(
    defaultValues.blocks.length ? defaultValues.blocks.map((block) => normalizeBlockForEditor(block)) : INITIAL_BLOCKS,
  );

  const contentJson = useMemo(() => JSON.stringify({ blocks }), [blocks]);

  const updateBlock = (index: number, patch: Partial<Block>) => {
    setBlocks((previous) => previous.map((item, idx) => (idx === index ? ({ ...item, ...patch } as Block) : item)));
  };

  const addBlock = (type: Block["type"]) => {
    setBlocks((previous) => [...previous, buildNewBlock(type)]);
  };

  return (
    <form className="space-y-4 rounded-xl border border-[#d3dbe5] bg-white p-5" action={submitAction}>
      {campaignId ? <input type="hidden" name="campaignId" value={campaignId} /> : null}
      <input type="hidden" name="contentJson" value={contentJson} />

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}
      {success ? <p className="text-sm text-[#166534]">{success}</p> : null}

      <label className="block text-sm text-[#334155]">
        Campaign name
        <input
          name="campaignName"
          defaultValue={defaultValues.campaignName}
          className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          placeholder="Spring retention email"
          required
        />
      </label>

      <label className="block text-sm text-[#334155]">
        Subject
        <input
          name="subject"
          defaultValue={defaultValues.subject}
          className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          placeholder="Your spring reset starts now"
          required
        />
      </label>

      <label className="block text-sm text-[#334155]">
        Preview text
        <input
          name="previewText"
          defaultValue={defaultValues.previewText}
          className="mt-1 w-full rounded-md border border-[#d3dbe5] px-3 py-2"
          placeholder="Fresh classes and offers for this month"
          required
        />
      </label>

      <label className="block rounded-md border border-dashed border-[#d3dbe5] bg-[#f8fbff] px-3 py-4 text-sm text-[#5a6d86]">
        Campaign image (optional)
        <input type="file" name="campaignImage" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-sm text-[#334155]" />
        {defaultValues.imageAssetUrl ? <span className="mt-2 block text-xs text-[#2a4f78]">Current image: {defaultValues.imageAssetUrl}</span> : null}
      </label>

      <section className="rounded-md border border-[#e2e8f0] p-3" data-testid="content-block-editor">
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
                <>
                  <RichTextField
                    value={block.contentHtml}
                    variant={variantFromBlock(block)}
                    onChange={(html) => updateBlock(index, { contentHtml: html } as Partial<Block>)}
                  />
                  <div className="mt-2">
                    <ColorPalettePopover
                      label={block.type === "heading" ? "Heading text color" : "Paragraph text color"}
                      value={block.textColor ?? (block.type === "heading" ? "#1f2735" : "#334155")}
                      onChange={(color) => updateBlock(index, { textColor: color } as Partial<Block>)}
                      testId={`${block.type}-color-controls`}
                      swatches={COLOR_PRESETS}
                    />
                  </div>
                </>
              ) : null}
              {block.type === "button" ? (
                <div className="mt-1 grid gap-2 md:grid-cols-2">
                  <RichTextField
                    value={block.labelHtml}
                    variant="button"
                    onChange={(html) => updateBlock(index, { labelHtml: html } as Partial<Block>)}
                  />
                  <input value={block.url} onChange={(event) => updateBlock(index, { url: event.target.value } as Partial<Block>)} className="rounded-md border border-[#d3dbe5] px-2 py-1 text-sm" />
                  <ColorPalettePopover
                    label="Button text color"
                    value={block.textColor ?? "#ffffff"}
                    onChange={(color) => updateBlock(index, { textColor: color } as Partial<Block>)}
                    testId="button-text-color-controls"
                    swatches={COLOR_PRESETS}
                  />
                  <ColorPalettePopover
                    label="Button background"
                    value={block.backgroundColor ?? "#1d3652"}
                    onChange={(color) => updateBlock(index, { backgroundColor: color } as Partial<Block>)}
                    testId="button-background-color-controls"
                    swatches={COLOR_PRESETS}
                  />
                  <div className="md:col-span-2">
                    <p className="mb-1 text-xs text-[#5a6d86]">Button preview</p>
                    <span
                      className="inline-flex items-center"
                      style={{
                        backgroundColor: block.backgroundColor ?? "#1d3652",
                        color: block.textColor ?? "#ffffff",
                        borderRadius: "10px",
                        padding: "12px 22px",
                        fontSize: "14px",
                        fontWeight: 600,
                        lineHeight: 1.2,
                      }}
                    >
                      Book now
                    </span>
                  </div>
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

      <div className="flex items-center justify-between gap-3 border-t border-[#e2e8f0] pt-4" data-testid="step1-footer-actions">
        <button type="submit" className="rounded border border-[#d3dbe5] px-4 py-2 text-sm text-[#1f2735]">
          Save draft
        </button>
        {nextHref ? (
          <Link href={nextHref} className="rounded-md bg-[#1d3652] px-4 py-2 text-sm text-white">
            Next
          </Link>
        ) : null}
      </div>
    </form>
  );
}
