import { createHash } from "node:crypto";

import { AdminLoginAbuseKeyType } from "@prisma/client";

import { prisma } from "@/lib/db";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_CAPTCHA_THRESHOLD = 3;
const DEFAULT_LOCKOUT_THRESHOLD = 6;
const DEFAULT_LOCKOUT_MS = 10 * 60 * 1000;
const DEFAULT_CAPTCHA_REQUIRED_MS = 30 * 60 * 1000;

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

const ADMIN_LOGIN_ABUSE_WINDOW_MS = parsePositiveIntEnv("ADMIN_LOGIN_ABUSE_WINDOW_MS", DEFAULT_WINDOW_MS);
const ADMIN_LOGIN_CAPTCHA_THRESHOLD = parsePositiveIntEnv("ADMIN_LOGIN_CAPTCHA_THRESHOLD", DEFAULT_CAPTCHA_THRESHOLD);
const ADMIN_LOGIN_LOCKOUT_THRESHOLD = parsePositiveIntEnv("ADMIN_LOGIN_LOCKOUT_THRESHOLD", DEFAULT_LOCKOUT_THRESHOLD);
const ADMIN_LOGIN_LOCKOUT_MS = parsePositiveIntEnv("ADMIN_LOGIN_LOCKOUT_MS", DEFAULT_LOCKOUT_MS);
const ADMIN_LOGIN_CAPTCHA_REQUIRED_MS = parsePositiveIntEnv(
  "ADMIN_LOGIN_CAPTCHA_REQUIRED_MS",
  DEFAULT_CAPTCHA_REQUIRED_MS,
);

const ADMIN_LOGIN_ABUSE_HASH_SECRET =
  process.env.ADMIN_LOGIN_ABUSE_HASH_SECRET ?? process.env.AUTH_SECRET ?? "admin-login-abuse-fallback";

type AdminLoginAbuseBucket = {
  keyType: AdminLoginAbuseKeyType;
  keyHash: string;
};

export type AdminLoginAbuseState = {
  isLocked: boolean;
  requiresCaptcha: boolean;
  retryAfterMs: number | null;
};

function hashKey(value: string): string {
  return createHash("sha256").update(`${ADMIN_LOGIN_ABUSE_HASH_SECRET}:${value}`).digest("hex");
}

function buildBuckets(input: { ip: string; normalizedEmail: string }): AdminLoginAbuseBucket[] {
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

function normalizeStateFromCounters(
  counters: Array<{ lockedUntil: Date | null; captchaRequiredUntil: Date | null }>,
  now: Date,
): AdminLoginAbuseState {
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
  const retryAfterMs = isLocked ? Math.max(...retryAfterMsValues) : null;

  const requiresCaptcha = counters.some((counter) => {
    if (!counter.captchaRequiredUntil) {
      return false;
    }

    return counter.captchaRequiredUntil.getTime() > nowTimestamp;
  });

  return {
    isLocked,
    requiresCaptcha,
    retryAfterMs,
  };
}

function emitSecurityLog(
  event: "admin_auth_guard_locked" | "admin_auth_guard_captcha" | "admin_auth_guard_failure_burst",
  input: {
    ip: string;
    normalizedEmail: string;
    failedAttempts: number;
    threshold: number;
    retryAfterMs: number | null;
  },
) {
  console.warn("[auth-security]", {
    event,
    scope: "admin_login",
    ip: input.ip,
    emailHash: hashKey(input.normalizedEmail),
    failedAttempts: input.failedAttempts,
    threshold: input.threshold,
    retryAfterMs: input.retryAfterMs,
    timestamp: new Date().toISOString(),
  });
}

async function getCountersForBuckets(buckets: AdminLoginAbuseBucket[]) {
  return prisma.adminLoginAbuseCounter.findMany({
    where: {
      OR: buckets.map((bucket) => ({
        keyType: bucket.keyType,
        keyHash: bucket.keyHash,
      })),
    },
    select: {
      keyType: true,
      keyHash: true,
      failedAttempts: true,
      firstFailedAt: true,
      lastFailedAt: true,
      lockedUntil: true,
      captchaRequiredUntil: true,
    },
  });
}

export async function getAdminLoginAbuseState(input: {
  ip: string;
  normalizedEmail: string;
}): Promise<AdminLoginAbuseState> {
  const now = new Date();
  const buckets = buildBuckets(input);
  const counters = await getCountersForBuckets(buckets);
  return normalizeStateFromCounters(counters, now);
}

export async function recordAdminLoginFailure(input: {
  ip: string;
  normalizedEmail: string;
  reason:
    | "invalid_user"
    | "missing_password_hash"
    | "email_not_verified"
    | "invalid_password"
    | "captcha_failed"
    | "prelocked";
}): Promise<AdminLoginAbuseState> {
  const now = new Date();
  const buckets = buildBuckets(input);

  const updatedCounters = await prisma.$transaction(async (tx) => {
    const updates = buckets.map(async (bucket) => {
      const existing = await tx.adminLoginAbuseCounter.findUnique({
        where: {
          keyType_keyHash: {
            keyType: bucket.keyType,
            keyHash: bucket.keyHash,
          },
        },
        select: {
          id: true,
          failedAttempts: true,
          firstFailedAt: true,
          lastFailedAt: true,
          lockedUntil: true,
          captchaRequiredUntil: true,
        },
      });

      const shouldResetWindow =
        !existing ||
        !existing.lastFailedAt ||
        now.getTime() - existing.lastFailedAt.getTime() >= ADMIN_LOGIN_ABUSE_WINDOW_MS;

      const previousAttempts = shouldResetWindow || !existing ? 0 : existing.failedAttempts;
      const nextAttempts = previousAttempts + 1;

      const shouldRequireCaptcha = nextAttempts >= ADMIN_LOGIN_CAPTCHA_THRESHOLD;
      const shouldLock = nextAttempts >= ADMIN_LOGIN_LOCKOUT_THRESHOLD;

      const nextCaptchaRequiredUntil = shouldRequireCaptcha
        ? new Date(now.getTime() + ADMIN_LOGIN_CAPTCHA_REQUIRED_MS)
        : existing?.captchaRequiredUntil ?? null;

      const nextLockedUntil = shouldLock ? new Date(now.getTime() + ADMIN_LOGIN_LOCKOUT_MS) : existing?.lockedUntil ?? null;

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
          captchaRequiredUntil: nextCaptchaRequiredUntil,
        },
        update: {
          failedAttempts: nextAttempts,
          firstFailedAt: shouldResetWindow ? now : (existing?.firstFailedAt ?? now),
          lastFailedAt: now,
          lockedUntil: nextLockedUntil,
          captchaRequiredUntil: nextCaptchaRequiredUntil,
        },
        select: {
          keyType: true,
          keyHash: true,
          failedAttempts: true,
          lockedUntil: true,
          captchaRequiredUntil: true,
        },
      });
    });

    return Promise.all(updates);
  });

  const state = normalizeStateFromCounters(updatedCounters, now);

  const maxAttempts = updatedCounters.reduce((max, counter) => Math.max(max, counter.failedAttempts), 0);

  if (state.isLocked) {
    emitSecurityLog("admin_auth_guard_locked", {
      ip: input.ip,
      normalizedEmail: input.normalizedEmail,
      failedAttempts: maxAttempts,
      threshold: ADMIN_LOGIN_LOCKOUT_THRESHOLD,
      retryAfterMs: state.retryAfterMs,
    });
  } else if (state.requiresCaptcha) {
    emitSecurityLog("admin_auth_guard_captcha", {
      ip: input.ip,
      normalizedEmail: input.normalizedEmail,
      failedAttempts: maxAttempts,
      threshold: ADMIN_LOGIN_CAPTCHA_THRESHOLD,
      retryAfterMs: state.retryAfterMs,
    });
  } else if (maxAttempts >= 2) {
    emitSecurityLog("admin_auth_guard_failure_burst", {
      ip: input.ip,
      normalizedEmail: input.normalizedEmail,
      failedAttempts: maxAttempts,
      threshold: ADMIN_LOGIN_CAPTCHA_THRESHOLD,
      retryAfterMs: state.retryAfterMs,
    });
  }

  console.info("[auth-security]", {
    event: "admin_auth_failure_recorded",
    scope: "admin_login",
    reason: input.reason,
    ip: input.ip,
    emailHash: hashKey(input.normalizedEmail),
    timestamp: now.toISOString(),
  });

  return state;
}

export async function resetAdminLoginFailureCounters(input: { ip: string; normalizedEmail: string }): Promise<void> {
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

export function isAdminLoginCaptchaEnforced(): boolean {
  return Boolean(process.env.ADMIN_LOGIN_CAPTCHA_SECRET_KEY);
}
