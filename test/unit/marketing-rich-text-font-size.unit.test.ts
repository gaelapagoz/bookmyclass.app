import { describe, expect, it } from "vitest";

import { sanitizeRichHtml } from "@/lib/marketing/marketing-rich-text";
import {
  normalizeMarketingContentJson,
  renderMarketingEmailHtml,
  renderMarketingPreviewHtml,
} from "@/lib/marketing/marketing-renderer";

describe("marketing rich text font-size pipeline", () => {
  it("keeps only allowed heading font sizes", () => {
    const input = '<p><span style="font-size:32px">Allowed</span> <span style="font-size:99px">Blocked</span></p>';
    const sanitized = sanitizeRichHtml(input, "heading");

    expect(sanitized).toContain('style="font-size:32px"');
    expect(sanitized).not.toContain("99px");
  });

  it("keeps only allowed paragraph font sizes", () => {
    const input = '<p><span style="font-size:16px">Allowed</span> <span style="font-size:32px">Blocked</span></p>';
    const sanitized = sanitizeRichHtml(input, "paragraph");

    expect(sanitized).toContain('style="font-size:16px"');
    expect(sanitized).not.toContain("32px");
  });

  it("strips font-size styling for button variant", () => {
    const input = '<span style="font-size:18px"><strong>Tap now</strong></span>';
    const sanitized = sanitizeRichHtml(input, "button");

    expect(sanitized).toBe("<strong>Tap now</strong>");
    expect(sanitized).not.toContain("font-size");
  });

  it("preserves allowed font-size through normalize and preview/email render", () => {
    const normalized = normalizeMarketingContentJson({
      blocks: [
        {
          type: "heading",
          contentHtml: '<p><span style="font-size:40px">Big heading</span></p>',
        },
        {
          type: "paragraph",
          contentHtml: '<p><span style="font-size:18px">Body copy</span></p>',
        },
        {
          type: "button",
          labelHtml: "<strong>Book now</strong>",
          url: "https://example.com/book",
        },
      ],
    });

    expect(normalized.blocks[0]).toMatchObject({
      type: "heading",
      contentHtml: '<p><span style="font-size:40px">Big heading</span></p>',
    });
    expect(normalized.blocks[1]).toMatchObject({
      type: "paragraph",
      contentHtml: '<p><span style="font-size:18px">Body copy</span></p>',
    });

    const previewHtml = renderMarketingPreviewHtml(normalized);
    expect(previewHtml).toContain("font-size:40px");
    expect(previewHtml).toContain("font-size:18px");

    const emailHtml = renderMarketingEmailHtml({
      contentJson: normalized,
      links: [],
      appUrl: "https://app.example.test",
      recipientToken: "recipient-token",
    });
    expect(emailHtml).toContain("font-size:40px");
    expect(emailHtml).toContain("font-size:18px");
  });
});
