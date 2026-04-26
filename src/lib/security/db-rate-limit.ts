import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { RateLimitResult } from "./rate-limit";

export type DbRateLimiterConfig = {
  maxAttempts: number;
  windowMs: number;
};

export function hashRateLimitKey(namespace: string, key: string): string {
  return createHash("sha256")
    .update(`${namespace}:${key}`)
    .digest("hex");
}

export async function checkAndRecordDbRateLimit(
  namespace: string,
  key: string,
  config: DbRateLimiterConfig,
): Promise<RateLimitResult> {
  const keyHash = hashRateLimitKey(namespace, key);
  const now = new Date();
  const windowStart = new Date(now.getTime() - config.windowMs);

  const existing = await prisma.rateLimitCounter.findFirst({ where: { keyHash } });
  if (!existing) {
    try {
      await prisma.rateLimitCounter.create({
        data: { keyHash, windowStartedAt: now, requestCount: 1 },
      });
      return { allowed: true };
    } catch {
      // Race: another concurrent request created it first — fall through to update path.
    }
  }

  const isRateLimited = await prisma.$transaction(async (tx) => {
    const resetResult = await tx.rateLimitCounter.updateMany({
      where: { keyHash, windowStartedAt: { lt: windowStart } },
      data: { windowStartedAt: now, requestCount: 1 },
    });
    if (resetResult.count > 0) {
      return false;
    }

    const consumeResult = await tx.rateLimitCounter.updateMany({
      where: {
        keyHash,
        windowStartedAt: { gte: windowStart },
        requestCount: { lt: config.maxAttempts },
      },
      data: { requestCount: { increment: 1 } },
    });
    return consumeResult.count === 0;
  });

  return { allowed: !isRateLimited };
}
