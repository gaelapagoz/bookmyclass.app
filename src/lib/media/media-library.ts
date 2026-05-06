import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { assertSafeMediaPublicPath, getLocalMediaRenderState } from "@/lib/media/secure-media";

export type MediaLibraryItem = {
  readonly path: string;
  readonly name: string;
};

const IMAGE_FILE_PATTERN = /\.(jpe?g|png|webp)$/i;

export async function listMediaLibraryImages(folder: string): Promise<MediaLibraryItem[]> {
  const normalizedFolder = assertSafeMediaPublicPath(`${folder}/placeholder.jpg`, [folder]).replace(
    /\/placeholder\.jpg$/,
    "",
  );
  const absoluteFolder = resolve(process.cwd(), "public", normalizedFolder.replace(/^\/+/, ""));

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

    const path = assertSafeMediaPublicPath(`${normalizedFolder}/${entry}`, [normalizedFolder]);
    const renderState = await getLocalMediaRenderState(path, { allowedFolders: [normalizedFolder] });
    if (!renderState.shouldRenderFallback && renderState.src) {
      items.push({ path: renderState.src, name: entry });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLearningMediaLibraryImages(): Promise<MediaLibraryItem[]> {
  return listMediaLibraryImages("/images/learning");
}
