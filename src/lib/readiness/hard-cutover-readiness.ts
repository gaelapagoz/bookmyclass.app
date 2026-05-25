const LEGACY_IMAGES_ROOT = ["/images"].join("");
const LEGACY_PUBLIC_IMAGES_ROOT = ["/public", "images"].join("/");
const LEGACY_PUBLIC_IMAGES_RELATIVE = ["public", "images"].join("/");

export const LEGACY_MEDIA_PATH_PATTERNS = [
  `${LEGACY_IMAGES_ROOT}/instructors`,
  `${LEGACY_IMAGES_ROOT}/instructors/`,
  `${LEGACY_IMAGES_ROOT}/classes`,
  `${LEGACY_IMAGES_ROOT}/classes/`,
  `${LEGACY_IMAGES_ROOT}/learning`,
  `${LEGACY_IMAGES_ROOT}/learning/`,
  LEGACY_PUBLIC_IMAGES_ROOT,
  `${LEGACY_PUBLIC_IMAGES_ROOT}/`,
  LEGACY_PUBLIC_IMAGES_RELATIVE,
  `${LEGACY_PUBLIC_IMAGES_RELATIVE}/`,
] as const;

export type MediaLegacyPathCount = {
  readonly label: string;
  readonly count: number;
};

export type MediaHardCutoverReadiness = {
  readonly ok: boolean;
  readonly blockers: readonly string[];
};

export function isLegacyMediaPath(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return LEGACY_MEDIA_PATH_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function evaluateMediaHardCutoverReadiness(counts: readonly MediaLegacyPathCount[]): MediaHardCutoverReadiness {
  const blockers = counts
    .filter((entry) => entry.count > 0)
    .map((entry) => `${entry.label} has ${entry.count} legacy media path reference(s)`);

  return {
    ok: blockers.length === 0,
    blockers,
  };
}
