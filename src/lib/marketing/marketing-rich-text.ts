import sanitizeHtml from "sanitize-html";

const ALLOWED_ALIGN = new Set(["left", "center", "right"]);
export type RichTextVariant = "heading" | "paragraph" | "button";

const FONT_SIZE_PRESETS: Record<RichTextVariant, ReadonlySet<string>> = {
  heading: new Set(["28px", "32px", "40px"]),
  paragraph: new Set(["14px", "16px", "18px"]),
  button: new Set(),
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function sanitizeRawHtml(input: string, variant: RichTextVariant): string {
  const allowedTags = variant === "button" ? ["strong", "em", "u"] : ["p", "strong", "em", "u", "a", "span", "br"];
  const allowedFontSizePatterns = [...FONT_SIZE_PRESETS[variant]].map((value) => new RegExp(`^${value}$`));
  const allowedAlignPatterns = [...ALLOWED_ALIGN].map((value) => new RegExp(`^${value}$`));

  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes: {
      a: variant === "button" ? [] : ["href"],
      p: variant === "button" ? [] : ["style"],
      span: variant === "button" ? [] : ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedStyles:
      variant === "button"
        ? {}
        : {
            p: {
              "text-align": allowedAlignPatterns,
              "font-size": allowedFontSizePatterns,
            },
            span: {
              "text-align": allowedAlignPatterns,
              "font-size": allowedFontSizePatterns,
            },
          },
    disallowedTagsMode: "discard",
  }).trim();
}

export function toPlainTextFromRichHtml(input: string): string {
  return decodeHtml(input.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function sanitizeRichHtml(input: string, variant: RichTextVariant): string {
  const sanitized = sanitizeRawHtml(input, variant);

  if (!sanitized) {
    return variant === "button" ? "" : "<p></p>";
  }

  if (variant === "button") {
    return sanitized;
  }

  if (!/^<p[\s>]/i.test(sanitized)) {
    return `<p>${sanitized}</p>`;
  }

  return sanitized;
}

export function sanitizePastedRichHtml(input: string, variant: RichTextVariant): string {
  return sanitizeRichHtml(input, variant)
    .replace(/class=\"[^\"]*\"/g, "")
    .replace(/id=\"[^\"]*\"/g, "");
}

const SNAPSHOT_ALLOWED_STYLE_PATTERN = /^[#(),.%\s\-a-zA-Z0-9/]+$/;

export function sanitizeCampaignSnapshotHtml(input: string): string {
  return sanitizeHtml(input, {
    allowedTags: ["div", "p", "strong", "em", "u", "a", "span", "br", "img", "hr"],
    allowedAttributes: {
      div: ["style"],
      p: ["style"],
      span: ["style"],
      a: ["href", "style"],
      img: ["src", "alt", "style"],
      hr: ["style"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowedStyles: {
      div: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
      p: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
      span: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
      a: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
      img: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
      hr: { "*": [SNAPSHOT_ALLOWED_STYLE_PATTERN] },
    },
    disallowedTagsMode: "discard",
  }).trim();
}

export function textToRichHtml(input: string, variant: RichTextVariant): string {
  const escaped = escapeHtml(input.trim());
  if (!escaped) {
    return variant === "button" ? "" : "<p></p>";
  }

  if (variant === "button") {
    return escaped;
  }

  return `<p>${escaped}</p>`;
}
