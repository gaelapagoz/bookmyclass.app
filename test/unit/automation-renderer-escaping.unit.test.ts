import { describe, expect, it } from "vitest";

import { normalizeMarketingContentJson, renderMarketingPreviewHtml } from "@/lib/marketing/marketing-renderer";

describe("automation renderer escaping", () => {
  it("renders verification link block as html anchor instead of escaped entities", () => {
    const normalized = normalizeMarketingContentJson({
      blocks: [{ type: "paragraph", text: "<a href=\"{{verificationUrl}}\">Verify email</a>" }],
    });
    const html = renderMarketingPreviewHtml(normalized);
    expect(html).toContain("<a href=");
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&lt;a");
  });

  it("keeps tokens as token text in preview html", () => {
    const normalized = normalizeMarketingContentJson({
      blocks: [{ type: "paragraph", text: "Hi {{contact.name.first}}" }],
    });
    const html = renderMarketingPreviewHtml(normalized);
    expect(html).toContain("{{contact.name.first}}");
  });
});

