import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

type LearningCourseSeed = {
  Title?: string;
  Thumbnail?: string;
};

type LearningSeed = {
  courses: LearningCourseSeed[];
  programs?: unknown[];
};

type UrlMapping = {
  url: string;
  slug: string;
  path: string;
};

const DEFAULT_SEED_PATH = "prisma/seed-data/learning-content.json";
const DEFAULT_OUTPUT_DIR = "public/images/learning";
const DEFAULT_QUALITY = 82;

function slugify(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : "learning-image";
}

function isWixThumbnail(value: string | undefined): value is string {
  return Boolean(value && /^https:\/\/static\.wixstatic\.com\//i.test(value));
}

async function fetchBinary(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const seedPath = resolve(process.argv[2] ?? DEFAULT_SEED_PATH);
  const outputDir = resolve(process.argv[3] ?? DEFAULT_OUTPUT_DIR);
  const qualityRaw = process.argv[4];
  const quality = qualityRaw ? Number(qualityRaw) : DEFAULT_QUALITY;

  if (!Number.isFinite(quality) || quality < 1 || quality > 100) {
    throw new Error(`Invalid JPEG quality '${qualityRaw}'. Expected 1-100.`);
  }

  const raw = await readFile(seedPath, "utf8");
  const seed = JSON.parse(raw) as LearningSeed;

  if (!Array.isArray(seed.courses)) {
    throw new Error(`Expected courses array in ${seedPath}`);
  }

  await mkdir(outputDir, { recursive: true });

  const urlToMapping = new Map<string, UrlMapping>();
  const usedSlugs = new Set<string>();

  for (let index = 0; index < seed.courses.length; index += 1) {
    const course = seed.courses[index];
    const thumbnail = course.Thumbnail;

    if (!isWixThumbnail(thumbnail) || urlToMapping.has(thumbnail)) {
      continue;
    }

    const baseSlug = slugify(course.Title?.trim() || `learning-image-${index + 1}`);
    let candidate = baseSlug;
    let suffix = 2;

    while (usedSlugs.has(candidate)) {
      candidate = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    usedSlugs.add(candidate);

    urlToMapping.set(thumbnail, {
      url: thumbnail,
      slug: candidate,
      path: `/images/learning/${candidate}.jpg`,
    });
  }

  const mappings = [...urlToMapping.values()];
  console.log(`[migrate-learning-wix-images] unique wix thumbnails: ${mappings.length}`);

  for (const mapping of mappings) {
    const source = await fetchBinary(mapping.url);
    const destination = resolve(outputDir, `${mapping.slug}.jpg`);

    await sharp(source)
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toFile(destination);
  }

  let migrated = 0;
  for (const course of seed.courses) {
    const thumbnail = course.Thumbnail;
    if (!isWixThumbnail(thumbnail)) {
      continue;
    }

    const mapping = urlToMapping.get(thumbnail);
    if (!mapping) {
      continue;
    }

    course.Thumbnail = mapping.path;
    migrated += 1;
  }

  await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`, "utf8");

  console.log(`[migrate-learning-wix-images] migrated course references: ${migrated}`);
  console.log(`[migrate-learning-wix-images] output dir: ${outputDir}`);
}

main().catch((error) => {
  console.error("[migrate-learning-wix-images][FAIL]", error instanceof Error ? error.message : error);
  process.exit(1);
});
