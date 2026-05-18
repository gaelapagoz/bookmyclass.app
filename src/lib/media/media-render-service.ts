import { access } from "node:fs/promises";

import {
  type CanonicalMediaFolder,
} from "@/lib/media/media-upload-service";
import {
  assertCanonicalMediaPublicPath,
  toCanonicalMediaAbsolutePath,
} from "@/lib/media/media-path-service";

export type MediaRenderState = {
  readonly src: string | null;
  readonly shouldRenderFallback: boolean;
};

type MediaAccessFileSystem = {
  readonly access: typeof access;
};

export async function getCanonicalMediaRenderState(
  publicPath: string | null | undefined,
  options: {
    readonly allowedFolders?: readonly CanonicalMediaFolder[];
    readonly fileSystem?: MediaAccessFileSystem;
  } = {},
): Promise<MediaRenderState> {
  if (!publicPath) {
    return { src: null, shouldRenderFallback: true };
  }

  let normalized: string;
  try {
    normalized = assertCanonicalMediaPublicPath(publicPath, options.allowedFolders);
  } catch {
    return { src: null, shouldRenderFallback: true };
  }

  try {
    await (options.fileSystem?.access ?? access)(toCanonicalMediaAbsolutePath(normalized));
    return { src: normalized, shouldRenderFallback: false };
  } catch {
    return { src: null, shouldRenderFallback: true };
  }
}
