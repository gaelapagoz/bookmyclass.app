import "./helpers/setup-env";

import { createHash } from "node:crypto";

import { hash } from "bcryptjs";
import { AdminLoginAbuseKeyType, Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authorizeCredentials } from "../../src/lib/auth/credentials-authorize";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

function hashAdminLoginBucketKey(value: string): string {
  const secret = process.env.ADMIN_LOGIN_ABUSE_HASH_SECRET ?? process.env.AUTH_SECRET ?? "admin-login-abuse-fallback";
  return createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

function buildAdminLoginBucketFilters(ip: string, normalizedEmail: string) {
  return [
    {
      keyType: AdminLoginAbuseKeyType.IP,
      keyHash: hashAdminLoginBucketKey(ip),
    },
    {
      keyType: AdminLoginAbuseKeyType.EMAIL,
      keyHash: hashAdminLoginBucketKey(normalizedEmail),
    },
    {
      keyType: AdminLoginAbuseKeyType.IP_EMAIL,
      keyHash: hashAdminLoginBucketKey(`${ip}:${normalizedEmail}`),
    },
  ];
}

describe("credentials authorize integration", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts valid credentials", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const result = await authorizeCredentials({
      email: "auth.client@example.test",
      password,
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);
    expect(result?.email).toBe(user.email);
  });

  it("rejects invalid credentials", async () => {
    const passwordHash = await hash("Password123!", 12);

    await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const result = await authorizeCredentials({
      email: "auth.client@example.test",
      password: "WrongPass123!",
    });

    expect(result).toBeNull();
  });

  it("rejects unverified users even with correct password", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Auth Client",
        firstName: "Auth",
        lastName: "Client",
        email: "unverified.auth.client@example.test",
        role: Role.CLIENT,
        passwordHash,
        emailVerified: null,
      },
    });

    const result = await authorizeCredentials({
      email: "unverified.auth.client@example.test",
      password,
    });

    expect(result).toBeNull();
  });

  it("accepts unverified admin users with valid credentials", async () => {
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: "Unverified Admin",
        firstName: "Unverified",
        lastName: "Admin",
        email: "unverified.admin@example.test",
        role: Role.ADMIN,
        passwordHash,
        emailVerified: null,
      },
    });

    const result = await authorizeCredentials({
      email: "unverified.admin@example.test",
      password,
      authFlow: "admin",
      captchaToken: "pass-captcha",
    });

    expect(result).not.toBeNull();
    expect(result?.id).toBe(user.id);
    expect(result?.role).toBe(Role.ADMIN);
  });

  it("blocks repeated failed admin attempts with database lockout", { timeout: 20000 }, async () => {
    const email = `rate-limit.${Date.now()}@example.test`;
    const password = "Password123!";
    const passwordHash = await hash(password, 12);

    await prisma.user.create({
      data: {
        name: "Rate Limited Admin",
        firstName: "Rate",
        lastName: "Limited",
        email,
        role: Role.ADMIN,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const request = {
      headers: new Headers({
        "x-forwarded-for": "203.0.113.10",
      }),
    };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const result = await authorizeCredentials(
        {
          email,
          password: "WrongPass123!",
          authFlow: "admin",
          captchaToken: "pass-captcha",
        },
        request,
      );
      expect(result).toBeNull();
    }

    const blockedResult = await authorizeCredentials(
      {
        email,
        password,
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    expect(blockedResult).toBeNull();

    const counters = await prisma.adminLoginAbuseCounter.findMany();
    expect(counters.length).toBeGreaterThanOrEqual(3);
    expect(counters.some((counter) => (counter.lockedUntil?.getTime() ?? 0) > Date.now())).toBe(true);
  });

  it("sets captcha-required state only after suspicious threshold", async () => {
    const email = `captcha.${Date.now()}@example.test`;
    const passwordHash = await hash("Password123!", 12);

    await prisma.user.create({
      data: {
        name: "Captcha Admin",
        firstName: "Captcha",
        lastName: "Admin",
        email,
        role: Role.ADMIN,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const request = {
      headers: new Headers({
        "x-forwarded-for": "198.51.100.44",
      }),
    };

    await authorizeCredentials(
      {
        email,
        password: "WrongPass123!",
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    const afterOneFailure = await prisma.adminLoginAbuseCounter.findMany();
    expect(afterOneFailure.every((counter) => (counter.captchaRequiredUntil?.getTime() ?? 0) <= Date.now())).toBe(true);

    await authorizeCredentials(
      {
        email,
        password: "WrongPass123!",
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    const afterTwoFailures = await prisma.adminLoginAbuseCounter.findMany();
    const captchaTriggeredAfterTwo = afterTwoFailures.some(
      (counter) => (counter.captchaRequiredUntil?.getTime() ?? 0) > Date.now(),
    );

    if (!captchaTriggeredAfterTwo) {
      await authorizeCredentials(
        {
          email,
          password: "WrongPass123!",
          authFlow: "admin",
          captchaToken: "pass-captcha",
        },
        request,
      );

      const afterThreeFailures = await prisma.adminLoginAbuseCounter.findMany();
      expect(afterThreeFailures.some((counter) => (counter.captchaRequiredUntil?.getTime() ?? 0) > Date.now())).toBe(true);
      return;
    }

    expect(captchaTriggeredAfterTwo).toBe(true);
  });

  it("resets admin abuse counters after successful login", async () => {
    const email = `reset-counter.${Date.now()}@example.test`;
    const password = "Password123!";
    const passwordHash = await hash(password, 12);
    const ip = "198.51.100.11";
    const normalizedEmail = email.toLowerCase();
    const bucketFilters = buildAdminLoginBucketFilters(ip, normalizedEmail);

    await prisma.user.create({
      data: {
        name: "Counter Reset Admin",
        firstName: "Counter",
        lastName: "Reset",
        email,
        role: Role.MASTER_ADMIN,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const request = {
      headers: new Headers({
        "x-forwarded-for": ip,
      }),
    };

    await authorizeCredentials(
      {
        email,
        password: "WrongPass123!",
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    await authorizeCredentials(
      {
        email,
        password: "WrongPass123!",
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    const countersAfterFailures = await prisma.adminLoginAbuseCounter.findMany({
      where: {
        OR: bucketFilters,
      },
    });
    expect(countersAfterFailures).toHaveLength(3);
    expect(countersAfterFailures.some((counter) => counter.failedAttempts > 0)).toBe(true);

    const success = await authorizeCredentials(
      {
        email,
        password,
        authFlow: "admin",
        captchaToken: "pass-captcha",
      },
      request,
    );

    expect(success).not.toBeNull();

    const counters = await prisma.adminLoginAbuseCounter.findMany({
      where: {
        OR: bucketFilters,
      },
    });
    expect(counters).toHaveLength(3);
    for (const counter of counters) {
      expect(counter.failedAttempts).toBe(0);
      expect(counter.firstFailedAt).toBeNull();
      expect(counter.lastFailedAt).toBeNull();
      expect(counter.lockedUntil).toBeNull();
      expect(counter.captchaRequiredUntil).toBeNull();
      expect(counter.lastSuccessAt).not.toBeNull();
    }
  });
});
