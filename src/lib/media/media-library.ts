import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { assertCanonicalMediaFolder, type CanonicalMediaFolder } from "@/lib/media/media-upload-service";
import { assertCanonicalMediaPublicPath } from "@/lib/media/media-path-service";
import { getCanonicalMediaRenderState } from "@/lib/media/media-render-service";
import { assertContainedPath, resolveUploadsConfig } from "@/lib/media/upload-config";

export type MediaLibraryItem = {
  readonly path: string;
  readonly name: string;
};

const IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp)$/i;

export async function listMediaLibraryImages(folder: CanonicalMediaFolder): Promise<MediaLibraryItem[]> {
  const safeFolder = assertCanonicalMediaFolder(folder);
  const config = resolveUploadsConfig();
  const normalizedFolder = `${config.publicUploadsBasePath}/${safeFolder}`;
  const absoluteFolder = resolve(config.uploadsDir, safeFolder);
  assertContainedPath(config.uploadsDir, absoluteFolder);

  let entries: string[];
  try {
    entries = await readdir(absoluteFolder);
  } catch {
    return [];
  }

  const items: MediaLibraryItem[] = [];
  for (const entry of entries) {
    if (!IMAGE_FILE_PATTERN.test(entry)) {
      continue;
    }

    const path = assertCanonicalMediaPublicPath(`${normalizedFolder}/${entry}`, [safeFolder]);
    const renderState = await getCanonicalMediaRenderState(path, { allowedFolders: [safeFolder] });
    if (!renderState.shouldRenderFallback && renderState.src) {
      items.push({ path: renderState.src, name: entry });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLearningMediaLibraryImages(): Promise<MediaLibraryItem[]> {
  return listMediaLibraryImages("learning");
}
