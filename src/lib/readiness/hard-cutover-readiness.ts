export const LEGACY_MEDIA_PATH_PATTERNS = [
  "/images/instructors",
  "/images/instructors/",
  "/images/classes",
  "/images/classes/",
  "/images/learning",
  "/images/learning/",
  "/public/images",
  "/public/images/",
  "public/images",
  "public/images/",
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
