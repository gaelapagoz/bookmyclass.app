export type SeededRng = {
  /** Returns a deterministic float in [0, 1). */
  next: () => number;
  /** Returns a deterministic integer in [minInclusive, maxInclusive]. */
  int: (minInclusive: number, maxInclusive: number) => number;
  /** Picks a deterministic element from a non-empty array. */
  pick: <T>(items: readonly T[]) => T;
  /** Returns a deterministically shuffled copy of the array. */
  shuffle: <T>(items: readonly T[]) => T[];
};

/**
 * Linear congruential generator seeded with the given integer.
 * Produces the same sequence for the same seed every run.
 */
export function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number): number => {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    if (max < min) return min;
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error("SeededRng.pick requires a non-empty array.");
    return items[int(0, items.length - 1)]!;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const current = copy[i]!;
      copy[i] = copy[j]!;
      copy[j] = current;
    }
    return copy;
  };

  return { next, int, pick, shuffle };
}
