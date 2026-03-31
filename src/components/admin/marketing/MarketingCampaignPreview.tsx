"use client";

import { useMemo } from "react";

import { normalizeMarketingContentJson, renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";

type Props = {
  blocksJson: string;
};

export default function MarketingCampaignPreview({ blocksJson }: Props) {
  const html = useMemo(() => {
    try {
      const parsed = JSON.parse(blocksJson) as { blocks?: unknown };
      const normalized = normalizeMarketingContentJson(parsed);
      return renderMarketingPreviewHtml(normalized);
    } catch {
      return "<p style=\"color:#7b2d2d;font-family:Arial,sans-serif;\">Preview unavailable: invalid content blocks.</p>";
    }
  }, [blocksJson]);

  return (
    <section className="rounded-xl border border-[#d3dbe5] bg-white p-4">
      <h3 className="text-base font-semibold text-[#1f2735]">Preview</h3>
      <div className="mt-3 rounded-md border border-[#e2e8f0] bg-[#f8fbff] p-4" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}

