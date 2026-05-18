"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";

type Block =
  | { type: "heading"; contentHtml: string; textColor?: string }
  | { type: "paragraph"; contentHtml: string; textColor?: string }
  | { type: "button"; labelHtml: string; url: string; textColor?: string; backgroundColor?: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "divider" }
  | { type: "spacer"; size: number };

type TokenGroup = { group: string; tokens: readonly string[] };

type Props = {
  templateKey: string;
  defaultName: string;
  defaultSubjectTemplate: string;
  defaultPreviewText: string;
  defaultBlocks: Block[];
  defaultEmailBackgroundColor?: string;
  defaultContentWidth?: number;
  tokenGroups: readonly TokenGroup[];
  submitAction: (formData: FormData) => void | Promise<void>;
  error?: string;
  success?: string;
  formId?: string;
  hideTopToolbar?: boolean;
};

type LeftPanel = "add" | "themes" | "background";

const COLOR_PALETTE = ["#0f172a", "#334155", "#0f766e", "#1d4ed8", "#7c2d12", "#7f1d1d"];
const BG_PALETTE = ["#f8fafc", "#f7f4ef", "#eef2f7", "#0b2545"];

function normalizeBlocks(defaultBlocks: Block[]): Block[] {
  if (defaultBlocks.length > 0) return defaultBlocks;
  return [
    { type: "heading", contentHtml: "<p>Welcome, {{contact.name.first}}</p>" },
    { type: "paragraph", contentHtml: "<p>Start editing this template with the visual builder.</p>" },
    { type: "button", labelHtml: "View classes", url: "{{website.url}}", textColor: "#ffffff", backgroundColor: "#1d3652" },
  ];
}

function toText(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

export default function AutomationTemplateEditor({
  templateKey,
  defaultName,
  defaultSubjectTemplate,
  defaultPreviewText,
  defaultBlocks,
  defaultEmailBackgroundColor,
  defaultContentWidth,
  tokenGroups,
  submitAction,
  error,
  success,
  formId,
  hideTopToolbar = false,
}: Props) {
  const [name, setName] = useState(defaultName);
  const [subjectTemplate, setSubjectTemplate] = useState(defaultSubjectTemplate);
  const [previewText, setPreviewText] = useState(defaultPreviewText);
  const [blocks, setBlocks] = useState<Block[]>(normalizeBlocks(defaultBlocks));
  const [emailBackgroundColor, setEmailBackgroundColor] = useState(defaultEmailBackgroundColor ?? "#eef2f7");
  const [contentWidth, setContentWidth] = useState(defaultContentWidth ?? 680);
  const [activePanel, setActivePanel] = useState<LeftPanel>("add");
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number>(0);
  const [activeField, setActiveField] = useState<{ type: "subject" | "preview" | "block-label" | "block-url" | "block-text"; index?: number } | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLInputElement>(null);
  const blockTextRefs = useRef<Array<HTMLInputElement | null>>([]);
  const blockLabelRefs = useRef<Array<HTMLInputElement | null>>([]);
  const blockUrlRefs = useRef<Array<HTMLInputElement | null>>([]);

  const contentJson = useMemo(
    () =>
      JSON.stringify({
        previewText,
        emailBackgroundColor,
        contentWidth,
        blocks,
      }),
    [previewText, emailBackgroundColor, contentWidth, blocks],
  );

  const previewHtml = useMemo(
    () => renderMarketingPreviewHtml({ previewText, emailBackgroundColor, contentWidth, blocks }),
    [previewText, emailBackgroundColor, contentWidth, blocks],
  );

  const addElement = (type: Block["type"]) => {
    const next: Block =
      type === "heading"
        ? { type, contentHtml: "<p>Heading</p>" }
        : type === "paragraph"
          ? { type, contentHtml: "<p>Text block</p>" }
          : type === "button"
            ? { type, labelHtml: "Button", url: "https://example.com", textColor: "#ffffff", backgroundColor: "#1d3652" }
            : type === "image"
              ? { type, url: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=1200&auto=format&fit=crop&q=80", alt: "Hero" }
              : type === "divider"
                ? { type }
                : { type, size: 24 };
    setBlocks((prev) => [...prev, next]);
    setSelectedBlockIndex(blocks.length);
  };

  const updateBlock = (index: number, next: Block) => {
    setBlocks((prev) => prev.map((item, idx) => (idx === index ? next : item)));
    setSelectedBlockIndex(index);
  };

  const insertToken = (token: string) => {
    const text = `{{${token}}}`;
    if (!activeField) return;
    if (activeField.type === "subject" && subjectRef.current) {
      const input = subjectRef.current;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setSubjectTemplate(input.value.slice(0, start) + text + input.value.slice(end));
      return;
    }
    if (activeField.type === "preview" && previewRef.current) {
      const input = previewRef.current;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setPreviewText(input.value.slice(0, start) + text + input.value.slice(end));
      return;
    }
    if (activeField.index == null) return;
    const idx = activeField.index;
    const block = blocks[idx];
    if (!block) return;
    if (activeField.type === "block-text" && (block.type === "heading" || block.type === "paragraph")) {
      const input = blockTextRefs.current[idx];
      const raw = toText(block.contentHtml);
      const start = input?.selectionStart ?? raw.length;
      const end = input?.selectionEnd ?? start;
      updateBlock(idx, { ...block, contentHtml: `<p>${raw.slice(0, start) + text + raw.slice(end)}</p>` });
      return;
    }
    if (activeField.type === "block-label" && block.type === "button") {
      const input = blockLabelRefs.current[idx];
      const start = input?.selectionStart ?? block.labelHtml.length;
      const end = input?.selectionEnd ?? start;
      updateBlock(idx, { ...block, labelHtml: block.labelHtml.slice(0, start) + text + block.labelHtml.slice(end) });
      return;
    }
    if (activeField.type === "block-url" && block.type === "button") {
      const input = blockUrlRefs.current[idx];
      const start = input?.selectionStart ?? block.url.length;
      const end = input?.selectionEnd ?? start;
      updateBlock(idx, { ...block, url: block.url.slice(0, start) + text + block.url.slice(end) });
    }
  };

  const selectedBlock = blocks[selectedBlockIndex];

  return (
    <form id={formId} action={submitAction} className="space-y-3">
      <input type="hidden" name="templateKey" value={templateKey} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="subjectTemplate" value={subjectTemplate} />
      <input type="hidden" name="previewText" value={previewText} />
      <input type="hidden" name="contentJson" value={contentJson} />

      {!hideTopToolbar ? (
        <header className="flex items-center justify-between rounded border border-[#d3dbe5] bg-white px-4 py-2">
          <Link href="/admin/automations" className="text-sm">Back to Automations</Link>
          <div className="flex items-center gap-2">
            <button type="button" disabled className="rounded border border-[#d3dbe5] px-3 py-1 text-sm">Undo</button>
            <button type="button" disabled className="rounded border border-[#d3dbe5] px-3 py-1 text-sm">Redo</button>
            <Link href={`/admin/automations/${templateKey}`} className="rounded border border-[#d3dbe5] px-3 py-1 text-sm">Preview & Test</Link>
            <button type="submit" className="rounded bg-[#2958d9] px-4 py-1.5 text-sm font-semibold text-white">Save & Continue</button>
          </div>
        </header>
      ) : null}

      {error ? <p className="rounded border border-[#fca5a5] bg-[#fef2f2] px-3 py-2 text-sm text-[#7b2d2d]">{error === "invalid_tokens" ? "Template contains variables that are not allowed for this trigger." : error}</p> : null}
      {success === "1" ? <p className="rounded border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2 text-sm text-[#166534]">Template saved successfully.</p> : null}

      <div className="grid gap-3 xl:grid-cols-[260px_1fr_280px]">
        <aside className="rounded border border-[#d3dbe5] bg-white p-3">
          <div className="mb-3 flex items-center gap-2 text-sm">
            <button type="button" onClick={() => setActivePanel("add")} className={`rounded px-2 py-1 ${activePanel === "add" ? "bg-[#e8eefc]" : ""}`}>Add</button>
            <button type="button" onClick={() => setActivePanel("themes")} className={`rounded px-2 py-1 ${activePanel === "themes" ? "bg-[#e8eefc]" : ""}`}>Themes</button>
            <button type="button" onClick={() => setActivePanel("background")} className={`rounded px-2 py-1 ${activePanel === "background" ? "bg-[#e8eefc]" : ""}`}>Background</button>
          </div>

          {activePanel === "add" ? (
            <>
              <h2 className="mb-2 text-sm font-semibold">Add elements</h2>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ["Text", "paragraph"],
                  ["Heading", "heading"],
                  ["Image", "image"],
                  ["Button", "button"],
                  ["Divider", "divider"],
                  ["HTML", "paragraph"],
                  ["Columns", "divider"],
                  ["Logo", "image"],
                  ["Video", "image"],
                  ["Subscribe", "button"],
                  ["Link", "button"],
                  ["Social", "paragraph"],
                ].map(([label, type]) => (
                  <button key={label} type="button" onClick={() => addElement(type as Block["type"])} className="rounded border border-[#d3dbe5] px-2 py-3">{label}</button>
                ))}
              </div>
            </>
          ) : null}

          {activePanel === "themes" ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Theme colors</h2>
              <p className="text-xs text-[#5a6d86]">Apply button colors quickly.</p>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-[#5a6d86]">Button foreground</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={`fg-${color}`}
                      type="button"
                      title={color}
                      onClick={() => {
                        if (selectedBlock?.type === "button") {
                          updateBlock(selectedBlockIndex, { ...selectedBlock, textColor: color });
                        }
                      }}
                      className="h-7 w-7 rounded border"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase text-[#5a6d86]">Button background</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={`bg-${color}`}
                      type="button"
                      title={color}
                      onClick={() => {
                        if (selectedBlock?.type === "button") {
                          updateBlock(selectedBlockIndex, { ...selectedBlock, backgroundColor: color });
                        }
                      }}
                      className="h-7 w-7 rounded border"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {activePanel === "background" ? (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold">Background</h2>
              <p className="text-sm">Email background</p>
              <div className="flex gap-2">
                {BG_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    title={color}
                    onClick={() => setEmailBackgroundColor(color)}
                    className={`h-7 w-7 rounded border ${emailBackgroundColor === color ? "ring-2 ring-[#a855f7]" : ""}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <label className="block text-sm">
                Content width
                <input
                  type="range"
                  min={420}
                  max={760}
                  step={10}
                  value={contentWidth}
                  onChange={(e) => setContentWidth(Number(e.target.value))}
                  className="mt-2 w-full"
                />
              </label>
            </div>
          ) : null}
        </aside>

        <section className="space-y-3 rounded border border-[#d3dbe5] bg-[#cfd6df] p-3">
          <div className="rounded border border-[#d3dbe5] bg-white px-3 py-2">
            <label className="block text-sm">Display name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border border-[#d3dbe5] px-2 py-1" /></label>
            <label className="mt-2 block text-sm">Subject line<input ref={subjectRef} value={subjectTemplate} onFocus={() => setActiveField({ type: "subject" })} onChange={(e) => setSubjectTemplate(e.target.value)} className="mt-1 w-full rounded border border-[#d3dbe5] px-2 py-1 font-mono" /></label>
            <label className="mt-2 block text-sm">Preview text<input ref={previewRef} value={previewText} onFocus={() => setActiveField({ type: "preview" })} onChange={(e) => setPreviewText(e.target.value)} className="mt-1 w-full rounded border border-[#d3dbe5] px-2 py-1" /></label>
          </div>

          <div className="rounded-xl border border-[#d3dbe5] p-4" style={{ backgroundColor: emailBackgroundColor }}>
            <div className="mx-auto rounded-xl border border-[#e2e8f0] bg-white" style={{ maxWidth: `${contentWidth}px` }}>
              <div className="border-b border-[#e2e8f0] px-4 py-3 text-center text-2xl font-semibold">Yoga Pilates Fitness Studio</div>
              <div className="p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
              <div className="border-t border-[#e2e8f0] p-4 text-center text-xs text-[#64748b]">Footer</div>
            </div>
          </div>

          <div className="space-y-2 rounded border border-[#d3dbe5] bg-white p-3">
            {blocks.map((block, index) => (
              <div key={`${block.type}-${index}`} className={`rounded border p-2 text-sm ${selectedBlockIndex === index ? "border-[#3b82f6]" : "border-[#e8edf3]"}`}>
                <button type="button" onClick={() => setSelectedBlockIndex(index)} className="mb-1 text-left text-xs uppercase text-[#5a6d86]">{block.type}</button>
                {(block.type === "heading" || block.type === "paragraph") ? (
                  <input
                    ref={(el) => { blockTextRefs.current[index] = el; }}
                    value={toText(block.contentHtml)}
                    onFocus={() => {
                      setSelectedBlockIndex(index);
                      setActiveField({ type: "block-text", index });
                    }}
                    onChange={(e) => updateBlock(index, { ...block, contentHtml: `<p>${e.target.value}</p>` })}
                    className="w-full rounded border border-[#d3dbe5] px-2 py-1"
                  />
                ) : null}
                {block.type === "button" ? (
                  <div className="space-y-1">
                    <input ref={(el) => { blockLabelRefs.current[index] = el; }} value={block.labelHtml} onFocus={() => { setSelectedBlockIndex(index); setActiveField({ type: "block-label", index }); }} onChange={(e) => updateBlock(index, { ...block, labelHtml: e.target.value })} className="w-full rounded border border-[#d3dbe5] px-2 py-1" />
                    <input ref={(el) => { blockUrlRefs.current[index] = el; }} value={block.url} onFocus={() => { setSelectedBlockIndex(index); setActiveField({ type: "block-url", index }); }} onChange={(e) => updateBlock(index, { ...block, url: e.target.value })} className="w-full rounded border border-[#d3dbe5] px-2 py-1 font-mono" />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded border border-[#d3dbe5] bg-white p-3">
          <h2 className="text-sm font-semibold">Block style</h2>
          {selectedBlock && (selectedBlock.type === "heading" || selectedBlock.type === "paragraph") ? (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">Text color</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {COLOR_PALETTE.map((color) => (
                  <button key={`txt-${color}`} type="button" onClick={() => updateBlock(selectedBlockIndex, { ...selectedBlock, textColor: color })} className="h-7 w-7 rounded border" style={{ backgroundColor: color }} />
                ))}
              </div>
            </div>
          ) : null}
          {selectedBlock?.type === "button" ? (
            <div className="mt-2 space-y-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">Button text</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {COLOR_PALETTE.map((color) => (
                    <button key={`btn-txt-${color}`} type="button" onClick={() => updateBlock(selectedBlockIndex, { ...selectedBlock, textColor: color })} className="h-7 w-7 rounded border" style={{ backgroundColor: color }} />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">Button background</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {COLOR_PALETTE.map((color) => (
                    <button key={`btn-bg-${color}`} type="button" onClick={() => updateBlock(selectedBlockIndex, { ...selectedBlock, backgroundColor: color })} className="h-7 w-7 rounded border" style={{ backgroundColor: color }} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <h2 className="mt-5 text-sm font-semibold">Variable picker</h2>
          <p className="mt-1 text-xs text-[#5a6d86]">Click to insert at cursor.</p>
          <div className="mt-2 space-y-2">
            {tokenGroups.map((group) => (
              <section key={group.group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[#5a6d86]">{group.group}</h3>
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.tokens.map((token) => (
                    <button key={token} type="button" onClick={() => insertToken(token)} className="rounded bg-[#e8eefc] px-2 py-1 font-mono text-xs text-[#2647a5]">{`{{${token}}}`}</button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </aside>
      </div>
    </form>
  );
}
