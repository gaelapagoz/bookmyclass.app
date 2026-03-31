const ALLOWED_TAGS = new Set(["p", "strong", "em", "u", "a", "span", "br"]);
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

function sanitizeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed, "https://example.com");
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" || url.protocol === "tel:") {
      return trimmed;
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeStyle(styleValue: string, variant: RichTextVariant): string | null {
  const declarations = styleValue
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  const allowed: string[] = [];
  for (const declaration of declarations) {
    const [rawProp, rawValue] = declaration.split(":");
    if (!rawProp || !rawValue) {
      continue;
    }

    const prop = rawProp.trim().toLowerCase();
    const value = rawValue.trim().toLowerCase();

    if (prop === "text-align" && variant !== "button" && ALLOWED_ALIGN.has(value)) {
      allowed.push(`text-align:${value}`);
    }

    if (prop === "font-size" && FONT_SIZE_PRESETS[variant].has(value)) {
      allowed.push(`font-size:${value}`);
    }
  }

  return allowed.length > 0 ? allowed.join(";") : null;
}

function sanitizeTag(rawTag: string, variant: RichTextVariant): string {
  const closingMatch = rawTag.match(/^<\s*\/\s*([a-z0-9]+)\s*>$/i);
  if (closingMatch) {
    const tagName = closingMatch[1]?.toLowerCase() ?? "";
    if (!ALLOWED_TAGS.has(tagName)) {
      return "";
    }
    if (variant === "button" && (tagName === "a" || tagName === "p" || tagName === "span" || tagName === "br")) {
      return "";
    }
    return `</${tagName}>`;
  }

  const openMatch = rawTag.match(/^<\s*([a-z0-9]+)([^>]*)>$/i);
  if (!openMatch) {
    return "";
  }

  const tagName = openMatch[1]?.toLowerCase() ?? "";
  if (!ALLOWED_TAGS.has(tagName)) {
    return "";
  }

  if (variant === "button" && (tagName === "a" || tagName === "p" || tagName === "span" || tagName === "br")) {
    return "";
  }

  if (tagName === "br") {
    return "<br>";
  }

  const attrsRaw = openMatch[2] ?? "";
  const attrs: string[] = [];
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(attrsRaw)) !== null) {
    const attrName = (match[1] ?? "").toLowerCase();
    const attrValue = (match[3] ?? match[4] ?? match[5] ?? "").trim();

    if (tagName === "a" && variant !== "button" && attrName === "href") {
      const safeHref = sanitizeHref(attrValue);
      if (safeHref) {
        attrs.push(`href=\"${escapeHtml(safeHref)}\"`);
      }
      continue;
    }

    if ((tagName === "p" || tagName === "span") && attrName === "style") {
      const safeStyle = sanitizeStyle(attrValue, variant);
      if (safeStyle) {
        attrs.push(`style=\"${escapeHtml(safeStyle)}\"`);
      }
    }
  }

  const attrSegment = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
  return `<${tagName}${attrSegment}>`;
}

function sanitizeRawHtml(input: string, variant: RichTextVariant): string {
  const withoutScripts = input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");

  let output = "";
  let cursor = 0;
  const tagPattern = /<[^>]*>/g;

  for (const match of withoutScripts.matchAll(tagPattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (start > cursor) {
      const textChunk = withoutScripts.slice(cursor, start);
      output += escapeHtml(textChunk);
    }

    output += sanitizeTag(match[0], variant);
    cursor = end;
  }

  if (cursor < withoutScripts.length) {
    output += escapeHtml(withoutScripts.slice(cursor));
  }

  output = output
    .replace(/\s+(style=\")/g, " $1")
    .replace(/<p>\s*<\/p>/g, "")
    .trim();

  return output;
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

