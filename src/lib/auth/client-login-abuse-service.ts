import { createHash } from "node:crypto";
import { AdminLoginAbuseKeyType } from "@prisma/client";
import { prisma } from "@/lib/db";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOCKOUT_THRESHOLD = 6;
const DEFAULT_LOCKOUT_MS = 10 * 60 * 1000;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

const CLIENT_LOGIN_ABUSE_WINDOW_MS = parsePositiveIntEnv("CLIENT_LOGIN_ABUSE_WINDOW_MS", DEFAULT_WINDOW_MS);
const CLIENT_LOGIN_LOCKOUT_THRESHOLD = parsePositiveIntEnv(
  "CLIENT_LOGIN_LOCKOUT_THRESHOLD",
  DEFAULT_LOCKOUT_THRESHOLD,
);
const CLIENT_LOGIN_LOCKOUT_MS = parsePositiveIntEnv("CLIENT_LOGIN_LOCKOUT_MS", DEFAULT_LOCKOUT_MS);

const CLIENT_LOGIN_ABUSE_HASH_SECRET = process.env.AUTH_SECRET ?? "client-login-abuse-fallback";

type ClientLoginAbuseBucket = {
  keyType: AdminLoginAbuseKeyType;
  keyHash: string;
};

function hashKey(value: string): string {
  return createHash("sha256")
    .update(`${CLIENT_LOGIN_ABUSE_HASH_SECRET}:client-login:${value}`)
    .digest("hex");
}

function buildBuckets(input: { ip: string; normalizedEmail: string }): ClientLoginAbuseBucket[] {
  return [
    {
      keyType: AdminLoginAbuseKeyType.IP,
      keyHash: hashKey(input.ip),
    },
    {
      keyType: AdminLoginAbuseKeyType.EMAIL,
      keyHash: hashKey(input.normalizedEmail),
    },
    {
      keyType: AdminLoginAbuseKeyType.IP_EMAIL,
      keyHash: hashKey(`${input.ip}:${input.normalizedEmail}`),
    },
  ];
}

export type ClientLoginAbuseState = {
  isLocked: boolean;
  retryAfterMs: number | null;
};

function normalizeStateFromCounters(counters: Array<{ lockedUntil: Date | null }>, now: Date): ClientLoginAbuseState {
  const nowTimestamp = now.getTime();
  const retryAfterMsValues = counters
    .map((counter) => {
      if (!counter.lockedUntil) {
        return null;
      }
      const delta = counter.lockedUntil.getTime() - nowTimestamp;
      return delta > 0 ? delta : null;
    })
    .filter((value): value is number => value !== null);

  const isLocked = retryAfterMsValues.length > 0;
  return {
    isLocked,
    retryAfterMs: isLocked ? Math.max(...retryAfterMsValues) : null,
  };
}

export async function getClientLoginAbuseState(input: {
  ip: string;
  normalizedEmail: string;
}): Promise<ClientLoginAbuseState> {
  const now = new Date();
  const buckets = buildBuckets(input);
  const counters = await prisma.adminLoginAbuseCounter.findMany({
    where: {
      OR: buckets.map((bucket) => ({
        keyType: bucket.keyType,
        keyHash: bucket.keyHash,
      })),
    },
    select: {
      lockedUntil: true,
    },
  });

  return normalizeStateFromCounters(counters, now);
}

export async function recordClientLoginFailure(input: {
  ip: string;
  normalizedEmail: string;
}): Promise<ClientLoginAbuseState> {
  const now = new Date();
  const buckets = buildBuckets(input);

  const counters = await prisma.$transaction(async (tx) => {
    const updates = buckets.map(async (bucket) => {
      const existing = await tx.adminLoginAbuseCounter.findUnique({
        where: {
          keyType_keyHash: {
            keyType: bucket.keyType,
            keyHash: bucket.keyHash,
          },
        },
        select: {
          failedAttempts: true,
          firstFailedAt: true,
          lastFailedAt: true,
          lockedUntil: true,
        },
      });

      const shouldResetWindow =
        !existing?.lastFailedAt || now.getTime() - existing.lastFailedAt.getTime() >= CLIENT_LOGIN_ABUSE_WINDOW_MS;
      const previousAttempts = shouldResetWindow ? 0 : (existing?.failedAttempts ?? 0);
      const nextAttempts = previousAttempts + 1;
      const nextLockedUntil =
        nextAttempts >= CLIENT_LOGIN_LOCKOUT_THRESHOLD ? new Date(now.getTime() + CLIENT_LOGIN_LOCKOUT_MS) : null;

      return tx.adminLoginAbuseCounter.upsert({
        where: {
          keyType_keyHash: {
            keyType: bucket.keyType,
            keyHash: bucket.keyHash,
          },
        },
        create: {
          keyType: bucket.keyType,
          keyHash: bucket.keyHash,
          failedAttempts: nextAttempts,
          firstFailedAt: now,
          lastFailedAt: now,
          lockedUntil: nextLockedUntil,
          captchaRequiredUntil: null,
        },
        update: {
          failedAttempts: nextAttempts,
          firstFailedAt: shouldResetWindow ? now : (existing?.firstFailedAt ?? now),
          lastFailedAt: now,
          lockedUntil: nextLockedUntil,
          captchaRequiredUntil: null,
        },
        select: {
          lockedUntil: true,
        },
      });
    });

    return Promise.all(updates);
  });

  return normalizeStateFromCounters(counters, now);
}

export async function resetClientLoginFailureCounters(input: {
  ip: string;
  normalizedEmail: string;
}): Promise<void> {
  const now = new Date();
  const buckets = buildBuckets(input);

  await prisma.adminLoginAbuseCounter.updateMany({
    where: {
      OR: buckets.map((bucket) => ({
        keyType: bucket.keyType,
        keyHash: bucket.keyHash,
      })),
    },
    data: {
      failedAttempts: 0,
      firstFailedAt: null,
      lastFailedAt: null,
      lockedUntil: null,
      captchaRequiredUntil: null,
      lastSuccessAt: now,
    },
  });
}
