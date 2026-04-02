import { UserActivationStatus } from "@prisma/client";
import type { Role } from "@prisma/client";
import { z } from "zod";

import {
  getAdminLoginAbuseState,
  isAdminLoginCaptchaEnforced,
  recordAdminLoginFailure,
  resetAdminLoginFailureCounters,
} from "@/lib/auth/admin-login-abuse-service";
import { isAdminRole } from "@/lib/auth/admin-access";
import { verifyAdminLoginCaptcha } from "@/lib/auth/admin-login-captcha";
import { verifyPassword } from "@/lib/auth/password-service";
import { prisma } from "@/lib/db";
import { getClientIpFromHeaders } from "@/lib/security/rate-limit";

const credentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  authFlow: z.enum(["admin"]).optional(),
  captchaToken: z.string().trim().optional(),
  turnstileToken: z.string().trim().optional(),
  "cf-turnstile-response": z.string().trim().optional(),
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

function resolveCaptchaToken(parsedCredentials: z.infer<typeof credentialsSchema>): string | null {
  const token =
    parsedCredentials.captchaToken ?? parsedCredentials.turnstileToken ?? parsedCredentials["cf-turnstile-response"];

  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function authorizeCredentials(rawCredentials: unknown, rawRequest?: unknown): Promise<AuthUser | null> {
  const parsed = credentialsSchema.safeParse(rawCredentials);

  if (!parsed.success) {
    return null;
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  const password = parsed.data.password;
  const ip = getClientIpFromHeaders(getHeadersFromAuthorizeRequest(rawRequest));
  const isAdminSignInFlow = parsed.data.authFlow === "admin";
  const captchaToken = resolveCaptchaToken(parsed.data);
  const captchaEnforced = isAdminLoginCaptchaEnforced();

  if (isAdminSignInFlow) {
    const preState = await getAdminLoginAbuseState({
      ip,
      normalizedEmail,
    });

    if (preState.isLocked) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "prelocked",
      });
      return null;
    }

    if (preState.requiresCaptcha && captchaEnforced) {
      const captchaIsValid = await verifyAdminLoginCaptcha({
        token: captchaToken,
        ip,
      });

      if (!captchaIsValid) {
        await recordAdminLoginFailure({
          ip,
          normalizedEmail,
          reason: "captcha_failed",
        });
        return null;
      }
    }
  }

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
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

  const shouldApplyAdminAbuseGuard = isAdminSignInFlow || (user ? isAdminRole(user.role) : false);

  if (shouldApplyAdminAbuseGuard && !isAdminSignInFlow) {
    const state = await getAdminLoginAbuseState({
      ip,
      normalizedEmail,
    });

    if (state.isLocked) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "prelocked",
      });
      return null;
    }

    if (state.requiresCaptcha && captchaEnforced) {
      const captchaIsValid = await verifyAdminLoginCaptcha({
        token: captchaToken,
        ip,
      });

      if (!captchaIsValid) {
        await recordAdminLoginFailure({
          ip,
          normalizedEmail,
          reason: "captcha_failed",
        });
        return null;
      }
    }
  }

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE) {
    if (shouldApplyAdminAbuseGuard) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "invalid_user",
      });
    }
    return null;
  }

  if (!user.passwordHash) {
    if (shouldApplyAdminAbuseGuard) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "missing_password_hash",
      });
    }
    return null;
  }

  if (!user.emailVerified && !isAdminRole(user.role)) {
    if (shouldApplyAdminAbuseGuard) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "email_not_verified",
      });
    }
    return null;
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);
  if (!isValidPassword) {
    if (shouldApplyAdminAbuseGuard) {
      await recordAdminLoginFailure({
        ip,
        normalizedEmail,
        reason: "invalid_password",
      });
    }
    return null;
  }

  if (shouldApplyAdminAbuseGuard) {
    await resetAdminLoginFailureCounters({
      ip,
      normalizedEmail,
    });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}
