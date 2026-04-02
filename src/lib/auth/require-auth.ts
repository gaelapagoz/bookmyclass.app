import { UserActivationStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { isAdminRole } from "@/lib/auth/admin-access";

const DEFAULT_CUSTOMER_CALLBACK_URL = "/dashboard";
const DEFAULT_CUSTOMER_SIGN_IN_PATH = "/sign-in";
const DEFAULT_VERIFY_EMAIL_PATH = "/verify-email";
const DEFAULT_STALE_SESSION_PATH = "/auth/stale-session";
const DEFAULT_ADMIN_SIGN_IN_PATH = "/admin";
const DEFAULT_ADMIN_UNAUTHORIZED_PATH = "/admin?error=unauthorized";

type AuthenticatedSession = Session & {
  user: NonNullable<Session["user"]> & {
    id: string;
    role?: Role;
  };
};

type AdminSession = AuthenticatedSession & {
  user: AuthenticatedSession["user"] & {
    role: "ADMIN" | "MASTER_ADMIN";
  };
};

function withCallback(path: string, callbackUrl: string): string {
  return `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

function toAuthenticatedSession(session: Session | null): AuthenticatedSession | null {
  if (!session?.user?.id) {
    return null;
  }

  return {
    ...session,
    user: {
      ...session.user,
      id: session.user.id,
      role: session.user.role,
    },
  };
}

function failAuth(shouldThrow: boolean, code: "UNAUTHENTICATED" | "FORBIDDEN", redirectTo: string): never {
  if (shouldThrow) {
    throw new Error(code);
  }

  redirect(redirectTo);
}

export async function requireUserSession(options?: {
  callbackUrl?: string;
  signInPath?: string;
}): Promise<AuthenticatedSession> {
  const callbackUrl = options?.callbackUrl ?? DEFAULT_CUSTOMER_CALLBACK_URL;
  const signInPath = options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH;
  const session = toAuthenticatedSession(await auth());

  if (!session) {
    redirect(withCallback(signInPath, callbackUrl));
  }

  return session;
}

export async function requireVerifiedUser(options?: {
  callbackUrl?: string;
  signInPath?: string;
  staleSessionPath?: string;
  verifyEmailPath?: string;
}) {
  const callbackUrl = options?.callbackUrl ?? DEFAULT_CUSTOMER_CALLBACK_URL;
  const staleSessionPath = options?.staleSessionPath ?? DEFAULT_STALE_SESSION_PATH;
  const verifyEmailPath = options?.verifyEmailPath ?? DEFAULT_VERIFY_EMAIL_PATH;
  const session = await requireUserSession({
    callbackUrl,
    signInPath: options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH,
  });

  const { prisma } = await import("@/lib/db");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, emailVerified: true, activationStatus: true },
  });

  if (!user) {
    redirect(withCallback(staleSessionPath, callbackUrl));
  }

  if (user.activationStatus !== UserActivationStatus.ACTIVE || !user.emailVerified) {
    redirect(`${verifyEmailPath}?blocked=1&email=${encodeURIComponent(user.email)}`);
  }

  return session;
}

export async function requireAdminSession(options?: {
  signInPath?: string;
  unauthorizedPath?: string;
  throwOnFailure?: boolean;
}): Promise<AdminSession> {
  const session = toAuthenticatedSession(await auth());
  const signInPath = options?.signInPath ?? DEFAULT_ADMIN_SIGN_IN_PATH;
  const unauthorizedPath = options?.unauthorizedPath ?? DEFAULT_ADMIN_UNAUTHORIZED_PATH;

  if (!session) {
    failAuth(Boolean(options?.throwOnFailure), "UNAUTHENTICATED", signInPath);
  }

  const role = session.user.role;
  if (!isAdminRole(role)) {
    failAuth(Boolean(options?.throwOnFailure), "FORBIDDEN", unauthorizedPath);
  }

  return {
    ...session,
    user: {
      ...session.user,
      role,
    },
  };
}

export const requireAuth = requireVerifiedUser;
