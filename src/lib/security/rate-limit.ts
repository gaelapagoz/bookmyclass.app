export type RateLimitResult = {
  allowed: boolean;
  retryAfter?: number;
};

export type RateLimiterConfig = {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
};

type RateLimitEntry = {
  windowStart: number;
  attempts: number;
  blockedUntil: number | null;
};

export type RateLimiter = {
  checkLimit: (key: string) => RateLimitResult;
  recordFailure: (key: string) => void;
  reset: (key: string) => void;
};

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const store = new Map<string, RateLimitEntry>();

  function getOrCreateEntry(key: string, now: number): RateLimitEntry {
    const existing = store.get(key);
    if (!existing) {
      const created: RateLimitEntry = {
        windowStart: now,
        attempts: 0,
        blockedUntil: null,
      };
      store.set(key, created);
      return created;
    }

    if (existing.blockedUntil && existing.blockedUntil <= now) {
      existing.blockedUntil = null;
      existing.windowStart = now;
      existing.attempts = 0;
    }

    if (now - existing.windowStart >= config.windowMs) {
      existing.windowStart = now;
      existing.attempts = 0;
    }

    return existing;
  }

  function checkLimit(key: string): RateLimitResult {
    const now = Date.now();
    const entry = getOrCreateEntry(key, now);

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return {
        allowed: false,
        retryAfter: Math.max(1, entry.blockedUntil - now),
      };
    }

    return { allowed: true };
  }

  function recordFailure(key: string): void {
    const now = Date.now();
    const entry = getOrCreateEntry(key, now);

    if (entry.blockedUntil && entry.blockedUntil > now) {
      return;
    }

    entry.attempts += 1;
    if (entry.attempts >= config.maxAttempts) {
      entry.blockedUntil = now + config.blockDurationMs;
    }
  }

  function reset(key: string): void {
    store.delete(key);
  }

  return {
    checkLimit,
    recordFailure,
    reset,
  };
}

export function getClientIpFromHeaders(headers: Headers | null | undefined): string {
  if (!headers) {
    return "unknown";
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) {
    return realIp;
  }

  const cfIp = headers.get("cf-connecting-ip")?.trim();
  if (cfIp) {
    return cfIp;
  }

  return "unknown";
}
