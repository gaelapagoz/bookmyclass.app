type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const DEFAULT_TTL_MS = 30_000;

function resolveTtlMs(ttlMs?: number): number {
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    return DEFAULT_TTL_MS;
  }

  return Math.floor(ttlMs);
}

export function createInMemoryTtlCache<T>(options?: { defaultTtlMs?: number }) {
  const entries = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();
  const defaultTtlMs = resolveTtlMs(options?.defaultTtlMs);

  async function getOrLoad(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    if (process.env.NODE_ENV === "test") {
      return loader();
    }

    const now = Date.now();
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }

    const loadPromise = loader()
      .then((value) => {
        entries.set(key, {
          value,
          expiresAt: Date.now() + resolveTtlMs(ttlMs ?? defaultTtlMs),
        });

        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, loadPromise);
    return loadPromise;
  }

  return {
    getOrLoad,
    clear() {
      entries.clear();
      inFlight.clear();
    },
  };
}
