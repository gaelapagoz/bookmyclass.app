import { UserActivationStatus } from "@prisma/client";
import type { Role } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

import { isAdminRole } from "@/lib/auth/admin-access";
import { verifyPassword } from "@/lib/auth/password-service";
import { prisma } from "@/lib/db";
import { createRateLimiter, getClientIpFromHeaders } from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const loginRateLimiter = createRateLimiter({
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000,
  blockDurationMs: 15 * 60 * 1000,
});

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

function getHeadersFromAuthorizeRequest(rawRequest: unknown): Headers | undefined {
  if (!rawRequest || typeof rawRequest !== "object") {
    return undefined;
  }

  if ("headers" in rawRequest) {
    const headers = (rawRequest as { headers?: unknown }).headers;
    if (headers instanceof Headers) {
      return headers;
    }
  }

  return undefined;
}

function captureLoginRateLimitBlocked(ip: string, email: string) {
  Sentry.withScope((scope) => {
    scope.setTag("event", "rate_limit_triggered");
    scope.setExtra("route", "/auth/credentials");
    scope.setExtra("userId", null);
    scope.setExtra("ip", ip);
    scope.setExtra("email", email);
    Sentry.captureMessage("rate_limit_triggered");
  });
}

export async function authorizeCredentials(rawCredentials: unknown, rawRequest?: unknown): Promise<AuthUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials);

  if (!parsed.success) {
    return null;
  }

  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;
  const ip = getClientIpFromHeaders(getHeadersFromAuthorizeRequest(rawRequest));
  const rateLimitKey = `${ip}:${email}`;

  const limit = loginRateLimiter.checkLimit(rateLimitKey);
  if (!limit.allowed) {
    captureLoginRateLimitBlocked(ip, email);
    return null;
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: email,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerified: true,
      activationStatus: true,
      passwordHash: true,
    },
  });

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE) {
    loginRateLimiter.recordFailure(rateLimitKey);
    return null;
  }

  if (!user.passwordHash) {
    loginRateLimiter.recordFailure(rateLimitKey);
    return null;
  }

  if (!user.emailVerified && !isAdminRole(user.role)) {
    loginRateLimiter.recordFailure(rateLimitKey);
    return null;
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    loginRateLimiter.recordFailure(rateLimitKey);
    return null;
  }

  loginRateLimiter.reset(rateLimitKey);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
