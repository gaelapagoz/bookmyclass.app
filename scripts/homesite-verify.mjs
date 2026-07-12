import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const homesiteDir = join(repoRoot, "homesite");
const imageDir = join(repoRoot, "public", "images", "homesite");
const pages = [
  "index.html",
  "client-experience.html",
  "studio-operations.html",
  "engineering.html",
];

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]);

function withoutQuery(value) {
  return value.split("?")[0].split("#")[0];
}

function extractAttributeValues(html, attribute) {
  const values = [];
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "gi");
  for (const match of html.matchAll(pattern)) {
    values.push(match[1]);
  }
  return values;
}

function extractImageReferences(html) {
  const references = new Set();

  for (const src of extractAttributeValues(html, "src")) {
    if (src.startsWith("/images/homesite/")) {
      references.add(withoutQuery(src));
    }
  }

  for (const srcset of extractAttributeValues(html, "srcset")) {
    for (const candidate of srcset.split(",")) {
      const src = candidate.trim().split(/\s+/)[0];
      if (src?.startsWith("/images/homesite/")) {
        references.add(withoutQuery(src));
      }
    }
  }

  const metaImagePattern = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(metaImagePattern)) {
    const url = new URL(match[1], "https://bookmyclass.app");
    if (url.pathname.startsWith("/images/homesite/")) {
      references.add(withoutQuery(url.pathname));
    }
  }

  for (const match of html.matchAll(/\/images\/homesite\/[^"'()<>\s]+/g)) {
    references.add(withoutQuery(match[0]));
  }

  return [...references].sort();
}

function isHtmlDocument(buffer) {
  const start = buffer.toString("utf8", 0, Math.min(buffer.length, 160)).trimStart().toLowerCase();
  return start.startsWith("<!doctype html") || start.startsWith("<html");
}

function hasExpectedMagic(buffer, extension) {
  if (extension === ".jpg" || extension === ".jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".png") {
    return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  if (extension === ".gif") {
    return ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
  }
  if (extension === ".webp") {
    return buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }
  if (extension === ".svg") {
    const text = buffer.toString("utf8", 0, Math.min(buffer.length, 512)).toLowerCase();
    return text.includes("<svg");
  }
  return false;
}

const failures = [];
let referenceCount = 0;

for (const page of pages) {
  const pagePath = join(homesiteDir, page);
  if (!existsSync(pagePath)) {
    failures.push(`${page}: missing homesite page`);
    continue;
  }

  const html = readFileSync(pagePath, "utf8");
  const references = extractImageReferences(html);
  referenceCount += references.length;

  for (const reference of references) {
    const fileName = basename(reference);
    const imagePath = join(imageDir, fileName);
    const extension = extname(fileName).toLowerCase();

    if (!supportedExtensions.has(extension)) {
      failures.push(`${page}: unsupported image extension for ${reference}`);
      continue;
    }

    if (!existsSync(imagePath)) {
      failures.push(`${page}: missing image ${reference}`);
      continue;
    }

    const stats = statSync(imagePath);
    if (!stats.isFile() || stats.size === 0) {
      failures.push(`${page}: image is empty or not a file ${reference}`);
      continue;
    }

    const buffer = readFileSync(imagePath);
    if (isHtmlDocument(buffer)) {
      failures.push(`${page}: image appears to be an HTML document ${reference}`);
      continue;
    }

    if (!hasExpectedMagic(buffer, extension)) {
      failures.push(`${page}: image signature does not match extension ${reference}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Homesite verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Homesite verification passed for ${pages.length} pages and ${referenceCount} local image references.`);
