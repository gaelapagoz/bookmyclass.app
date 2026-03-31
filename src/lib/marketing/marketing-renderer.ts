import { randomUUID } from "node:crypto";
import { z } from "zod";

import { sanitizeRichHtml, textToRichHtml, toPlainTextFromRichHtml } from "@/lib/marketing/marketing-rich-text";

const headingBlockSchema = z.object({
  type: z.literal("heading"),
  contentHtml: z.string().optional(),
  text: z.string().optional(),
});

const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  contentHtml: z.string().optional(),
  text: z.string().optional(),
});

const buttonBlockSchema = z.object({
  type: z.literal("button"),
  labelHtml: z.string().optional(),
  text: z.string().optional(),
  url: z.url(),
});

const imageBlockSchema = z.object({
  type: z.literal("image"),
  url: z.url(),
  alt: z.string().max(240).optional(),
});

const dividerBlockSchema = z.object({ type: z.literal("divider") });

const spacerBlockSchema = z.object({
  type: z.literal("spacer"),
  size: z.number().int().min(8).max(80),
});

export const marketingBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  buttonBlockSchema,
  imageBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
]);

export const marketingContentSchema = z.object({
  blocks: z.array(marketingBlockSchema).min(1).max(60),
});

export type MarketingContentJson = z.infer<typeof marketingContentSchema>;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeHeadingBlock(block: z.infer<typeof headingBlockSchema>) {
  const htmlSource = block.contentHtml ?? textToRichHtml(block.text ?? "", "heading");
  return {
    type: "heading" as const,
    contentHtml: sanitizeRichHtml(htmlSource, "heading"),
  };
}

function normalizeParagraphBlock(block: z.infer<typeof paragraphBlockSchema>) {
  const htmlSource = block.contentHtml ?? textToRichHtml(block.text ?? "", "paragraph");
  return {
    type: "paragraph" as const,
    contentHtml: sanitizeRichHtml(htmlSource, "paragraph"),
  };
}

function normalizeButtonBlock(block: z.infer<typeof buttonBlockSchema>) {
  const htmlSource = block.labelHtml ?? textToRichHtml(block.text ?? "", "button");
  return {
    type: "button" as const,
    labelHtml: sanitizeRichHtml(htmlSource, "button"),
    url: block.url,
  };
}

export function normalizeMarketingContentJson(input: unknown): MarketingContentJson {
  const parsed = marketingContentSchema.parse(input);
  return {
    blocks: parsed.blocks.map((block) => {
      if (block.type === "heading") {
        return normalizeHeadingBlock(block);
      }
      if (block.type === "paragraph") {
        return normalizeParagraphBlock(block);
      }
      if (block.type === "button") {
        return normalizeButtonBlock(block);
      }
      if (block.type === "image") {
        return {
          type: "image",
          url: block.url,
          alt: block.alt,
        };
      }
      if (block.type === "divider") {
        return { type: "divider" };
      }
      return {
        type: "spacer",
        size: block.size,
      };
    }),
  };
}

function renderBlocksAsHtml(content: MarketingContentJson): string {
  return content.blocks
    .map((block) => {
      if (block.type === "heading") {
        const safe = sanitizeRichHtml(block.contentHtml ?? "<p></p>", "heading");
        return `<div style=\"font-family:Arial,sans-serif;line-height:1.35;margin:0 0 16px 0;color:#1f2735;\">${safe}</div>`;
      }
      if (block.type === "paragraph") {
        const safe = sanitizeRichHtml(block.contentHtml ?? "<p></p>", "paragraph");
        return `<div style=\"font-family:Arial,sans-serif;font-size:15px;line-height:1.6;margin:0 0 14px 0;color:#334155;\">${safe}</div>`;
      }
      if (block.type === "button") {
        const safeLabel = sanitizeRichHtml(block.labelHtml ?? "", "button");
        const fallbackLabel = toPlainTextFromRichHtml(safeLabel) || "Button";
        return `<p style=\"margin:0 0 16px 0;\"><a href=\"${escapeHtml(block.url)}\" style=\"display:inline-block;background:#1d3652;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-family:Arial,sans-serif;font-size:14px;\">${safeLabel || escapeHtml(fallbackLabel)}</a></p>`;
      }
      if (block.type === "image") {
        return `<p style=\"margin:0 0 16px 0;\"><img src=\"${escapeHtml(block.url)}\" alt=\"${escapeHtml(block.alt ?? "")}\" style=\"max-width:100%;height:auto;border-radius:6px;\" /></p>`;
      }
      if (block.type === "divider") {
        return '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />';
      }
      return `<div style=\"height:${block.size}px;\"></div>`;
    })
    .join("\n");
}

export type TrackingLink = {
  url: string;
  token: string;
};

export function extractTrackingLinks(content: MarketingContentJson): TrackingLink[] {
  const dedup = new Map<string, TrackingLink>();
  for (const block of content.blocks) {
    if (block.type !== "button") {
      continue;
    }
    if (!dedup.has(block.url)) {
      dedup.set(block.url, { url: block.url, token: randomUUID() });
    }
  }
  return [...dedup.values()];
}

export function renderMarketingPreviewHtml(contentJson: MarketingContentJson): string {
  return renderBlocksAsHtml(normalizeMarketingContentJson(contentJson));
}

export function renderMarketingEmailHtml(input: {
  contentJson: MarketingContentJson;
  links: TrackingLink[];
  appUrl: string;
  recipientToken: string;
}): string {
  const appUrl = input.appUrl.replace(/\/$/, "");
  const linksByUrl = new Map(input.links.map((link) => [link.url, link]));

  const normalized = normalizeMarketingContentJson(input.contentJson);

  const trackedContent: MarketingContentJson = {
    blocks: normalized.blocks.map((block) => {
      if (block.type !== "button") {
        return block;
      }
      const link = linksByUrl.get(block.url);
      if (!link) {
        return block;
      }
      return {
        ...block,
        url: `${appUrl}/m/click/${link.token}?r=${encodeURIComponent(input.recipientToken)}`,
      };
    }),
  };

  const body = renderBlocksAsHtml(trackedContent);
  const pixelUrl = `${appUrl}/m/open/${encodeURIComponent(input.recipientToken)}`;
  const unsubscribeUrl = `${appUrl}/m/unsubscribe/${encodeURIComponent(input.recipientToken)}`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f6fb;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;">
      <tr><td>${body}
      <p style="margin:24px 0 0 0;font-size:12px;font-family:Arial,sans-serif;color:#64748b;">
        If you no longer want marketing updates, <a href="${unsubscribeUrl}">unsubscribe</a>.
      </p>
      <img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;" />
      </td></tr>
    </table>
  </body>
</html>`;
}

