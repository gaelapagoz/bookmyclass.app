import { describe, expect, it } from "vitest";

import { sanitizeCampaignSnapshotHtml, sanitizeRichHtml } from "@/lib/marketing/marketing-rich-text";

describe("sanitizeRichHtml", () => {
  it("removes scripts, event handlers, javascript urls, and svg/math payloads", () => {
    const input = [
      '<script>alert("x")</script>',
      '<p onclick="alert(1)">Hello</p>',
      '<a href="javascript:alert(1)">Click</a>',
      "<svg><script>alert(2)</script></svg>",
      "<math><mi>x</mi></math>",
    ].join("");

    const sanitized = sanitizeRichHtml(input, "paragraph");

    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("<svg");
    expect(sanitized).not.toContain("<math");
    expect(sanitized).toContain("<p>Hello</p>");
    expect(sanitized).toContain("<a>Click</a>");
  });

  it("keeps only the allowed tag contract and allowed href schemes", () => {
    const input = '<p><strong>A</strong><em>B</em><u>C</u><span>D</span><br><a href="https://example.com">E</a><div>F</div></p>';
    const sanitized = sanitizeRichHtml(input, "paragraph");

    expect(sanitized).toContain("<p>");
    expect(sanitized).toContain("<strong>A</strong>");
    expect(sanitized).toContain("<em>B</em>");
    expect(sanitized).toContain("<u>C</u>");
    expect(sanitized).toContain("<span>D</span>");
    expect(sanitized).toContain("<br");
    expect(sanitized).toContain('href="https://example.com"');
    expect(sanitized).not.toContain("<div>");
  });

  it("handles malformed html without preserving executable attributes", () => {
    const input = '<p><strong>Open<a href="javascript:alert(1)" onclick="alert(2)">link';
    const sanitized = sanitizeRichHtml(input, "paragraph");

    expect(sanitized).toContain("<p>");
    expect(sanitized).toContain("<strong>Open");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("onclick");
  });

  it("keeps allowed text-align and variant font-size rules", () => {
    const headingInput = '<p style="text-align:center;font-size:40px;position:absolute">Heading</p>';
    const paragraphInput = '<p><span style="text-align:right;font-size:16px;font-weight:700">Body</span></p>';

    const heading = sanitizeRichHtml(headingInput, "heading");
    const paragraph = sanitizeRichHtml(paragraphInput, "paragraph");

    expect(heading).toContain('style="text-align:center;font-size:40px"');
    expect(heading).not.toContain("position:absolute");
    expect(paragraph).toContain('style="text-align:right;font-size:16px"');
    expect(paragraph).not.toContain("font-weight:700");
  });
});

describe("sanitizeCampaignSnapshotHtml", () => {
  it("preserves renderer snapshot shapes and strips unsafe protocols/scripts", () => {
    const input = [
      '<div style="font-family:Arial,sans-serif;line-height:1.35;color:#1f2735;">',
      '<p style="margin:0 0 18px 0;"><a href="https://example.com/book" style="display:inline-block;background:#1d3652;">Book</a></p>',
      '<img src="https://example.com/image.jpg" alt="hero" style="max-width:100%;height:auto;" />',
      '<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0;" />',
      "</div>",
      '<a href="javascript:alert(1)">bad</a>',
      '<a href="data:text/html;base64,SGk=">data</a>',
      "<script>alert(1)</script>",
    ].join("");

    const sanitized = sanitizeCampaignSnapshotHtml(input);

    expect(sanitized).toContain("<div");
    expect(sanitized).toContain("<img");
    expect(sanitized).toContain("<hr");
    expect(sanitized).toContain('href="https://example.com/book"');
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("data:text/html");
    expect(sanitized).not.toContain("<script");
  });
});
