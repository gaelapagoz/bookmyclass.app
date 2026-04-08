import { UserActivationStatus } from "@prisma/client";
import type { Role } from "@prisma/client";
import { z } from "zod";

import {
  getAdminLoginAbuseState,
  isAdminLoginCaptchaEnforced,
  recordAdminLoginFailure,
  resetAdminLoginFailureCounters,
} from "@/lib/auth/admin-login-abuse-service";
import {
  getClientLoginAbuseState,
  recordClientLoginFailure,
  resetClientLoginFailureCounters,
} from "@/lib/auth/client-login-abuse-service";
import { isAdminRole } from "@/lib/auth/admin-access";
import { verifyAdminLoginCaptcha } from "@/lib/auth/admin-login-captcha";
import { verifyPassword } from "@/lib/auth/password-service";
import { prisma } from "@/lib/db";
import { createPerfTrace } from "@/lib/monitoring/perf-trace";
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

type AuthCandidateUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: Date | null;
  activationStatus: UserActivationStatus;
  passwordHash: string | null;
};

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  emailVerified: true,
  activationStatus: true,
  passwordHash: true,
} as const;

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
  const trace = createPerfTrace("auth.authorizeCredentials", {
    ip,
    isAdminSignInFlow,
    normalizedEmail,
  });
  let lookupMode: "exact" | "fallback-insensitive" | "not-found" = "not-found";
  let authResult:
    | "invalid_payload"
    | "locked_client"
    | "locked_admin"
    | "captcha_failed"
    | "invalid_user"
    | "missing_password_hash"
    | "email_not_verified"
    | "invalid_password"
    | "success" = "invalid_payload";

  try {
    if (!isAdminSignInFlow) {
      const clientState = await trace.db("auth.getClientLoginAbuseState", () =>
        getClientLoginAbuseState({
          ip,
          normalizedEmail,
        }),
      );

      if (clientState.isLocked) {
        await trace.db("auth.recordClientLoginFailure.locked", () =>
          recordClientLoginFailure({
            ip,
            normalizedEmail,
          }),
        );
        authResult = "locked_client";
        return null;
      }
    }

    if (isAdminSignInFlow) {
      const preState = await trace.db("auth.getAdminLoginAbuseState.pre", () =>
        getAdminLoginAbuseState({
          ip,
          normalizedEmail,
        }),
      );

      if (preState.isLocked) {
        await trace.db("auth.recordAdminLoginFailure.prelocked", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "prelocked",
          }),
        );
        authResult = "locked_admin";
        return null;
      }

      if (preState.requiresCaptcha && captchaEnforced) {
        const captchaIsValid = await trace.db("auth.verifyAdminLoginCaptcha.pre", () =>
          verifyAdminLoginCaptcha({
            token: captchaToken,
            ip,
          }),
        );

        if (!captchaIsValid) {
          await trace.db("auth.recordAdminLoginFailure.captchaFailed.pre", () =>
            recordAdminLoginFailure({
              ip,
              normalizedEmail,
              reason: "captcha_failed",
            }),
          );
          authResult = "captcha_failed";
          return null;
        }
      }
    }

    const exactUser = await trace.db("auth.user.findUnique.email", () =>
      prisma.user.findUnique({
        where: {
          email: normalizedEmail,
        },
        select: AUTH_USER_SELECT,
      }),
    );

    const user: AuthCandidateUser | null =
      exactUser ??
      (await trace.db("auth.user.findFirst.emailInsensitiveFallback", () =>
        prisma.user.findFirst({
          where: {
            email: {
              equals: normalizedEmail,
              mode: "insensitive",
            },
          },
          select: AUTH_USER_SELECT,
        }),
      ));
    if (exactUser) {
      lookupMode = "exact";
    } else if (user) {
      lookupMode = "fallback-insensitive";
    } else {
      lookupMode = "not-found";
    }

    const shouldApplyAdminAbuseGuard = isAdminSignInFlow || (user ? isAdminRole(user.role) : false);

    if (shouldApplyAdminAbuseGuard && !isAdminSignInFlow) {
      const state = await trace.db("auth.getAdminLoginAbuseState.postUser", () =>
        getAdminLoginAbuseState({
          ip,
          normalizedEmail,
        }),
      );

      if (state.isLocked) {
        await trace.db("auth.recordAdminLoginFailure.prelocked.postUser", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "prelocked",
          }),
        );
        authResult = "locked_admin";
        return null;
      }

      if (state.requiresCaptcha && captchaEnforced) {
        const captchaIsValid = await trace.db("auth.verifyAdminLoginCaptcha.postUser", () =>
          verifyAdminLoginCaptcha({
            token: captchaToken,
            ip,
          }),
        );

        if (!captchaIsValid) {
          await trace.db("auth.recordAdminLoginFailure.captchaFailed.postUser", () =>
            recordAdminLoginFailure({
              ip,
              normalizedEmail,
              reason: "captcha_failed",
            }),
          );
          authResult = "captcha_failed";
          return null;
        }
      }
    }

    if (!user || user.activationStatus !== UserActivationStatus.ACTIVE) {
      if (!isAdminSignInFlow) {
        await trace.db("auth.recordClientLoginFailure.invalidUser", () =>
          recordClientLoginFailure({
            ip,
            normalizedEmail,
          }),
        );
      }
      if (shouldApplyAdminAbuseGuard) {
        await trace.db("auth.recordAdminLoginFailure.invalidUser", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "invalid_user",
          }),
        );
      }
      authResult = "invalid_user";
      return null;
    }

    if (!user.passwordHash) {
      if (!isAdminSignInFlow) {
        await trace.db("auth.recordClientLoginFailure.missingHash", () =>
          recordClientLoginFailure({
            ip,
            normalizedEmail,
          }),
        );
      }
      if (shouldApplyAdminAbuseGuard) {
        await trace.db("auth.recordAdminLoginFailure.missingHash", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "missing_password_hash",
          }),
        );
      }
      authResult = "missing_password_hash";
      return null;
    }

    if (!user.emailVerified && !isAdminRole(user.role)) {
      if (!isAdminSignInFlow) {
        await trace.db("auth.recordClientLoginFailure.emailNotVerified", () =>
          recordClientLoginFailure({
            ip,
            normalizedEmail,
          }),
        );
      }
      if (shouldApplyAdminAbuseGuard) {
        await trace.db("auth.recordAdminLoginFailure.emailNotVerified", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "email_not_verified",
          }),
        );
      }
      authResult = "email_not_verified";
      return null;
    }

    const isValidPassword = await verifyPassword(password, user.passwordHash);
    if (!isValidPassword) {
      if (!isAdminSignInFlow) {
        await trace.db("auth.recordClientLoginFailure.invalidPassword", () =>
          recordClientLoginFailure({
            ip,
            normalizedEmail,
          }),
        );
      }
      if (shouldApplyAdminAbuseGuard) {
        await trace.db("auth.recordAdminLoginFailure.invalidPassword", () =>
          recordAdminLoginFailure({
            ip,
            normalizedEmail,
            reason: "invalid_password",
          }),
        );
      }
      authResult = "invalid_password";
      return null;
    }

    if (shouldApplyAdminAbuseGuard) {
      await trace.db("auth.resetAdminLoginFailureCounters", () =>
        resetAdminLoginFailureCounters({
          ip,
          normalizedEmail,
        }),
      );
    }
    if (!isAdminSignInFlow) {
      await trace.db("auth.resetClientLoginFailureCounters", () =>
        resetClientLoginFailureCounters({
          ip,
          normalizedEmail,
        }),
      );
    }

    authResult = "success";

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  } finally {
    trace.log({ authResult, lookupMode });
  }
}
