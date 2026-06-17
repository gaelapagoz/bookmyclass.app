import { UserActivationStatus } from "@prisma/client";
import { redirect } from "next/navigation";

import { isAdminRole } from "@/lib/auth/admin-access";
import {
  getVerifiedCustomerState,
  type AuthenticatedSession,
  toAuthenticatedSession,
  VERIFIED_CUSTOMER_STALE_SESSION_PATH,
} from "@/lib/auth/verified-customer-state";

async function getAuth() {
  const { auth } = await import("@/auth");
  return auth;
}

const DEFAULT_CUSTOMER_CALLBACK_URL = "/dashboard";
const DEFAULT_CUSTOMER_SIGN_IN_PATH = "/sign-in";
const DEFAULT_VERIFY_EMAIL_PATH = "/verify-email";
const DEFAULT_STALE_SESSION_PATH = VERIFIED_CUSTOMER_STALE_SESSION_PATH;
const DEFAULT_ADMIN_SIGN_IN_PATH = "/admin";
const DEFAULT_ADMIN_UNAUTHORIZED_PATH = "/admin?error=unauthorized";

type AdminSession = AuthenticatedSession & {
  user: AuthenticatedSession["user"] & {
    role: "ADMIN" | "MASTER_ADMIN";
  };
};

type TeacherSession = AuthenticatedSession & {
  user: AuthenticatedSession["user"] & {
    role: "TEACHER";
  };
};

type StaffSession = AuthenticatedSession & {
  user: AuthenticatedSession["user"] & {
    role: "TEACHER" | "ADMIN" | "MASTER_ADMIN";
  };
};

function withCallback(path: string, callbackUrl: string): string {
  return `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
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
  const auth = await getAuth();
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
}): Promise<AuthenticatedSession> {
  const callbackUrl = options?.callbackUrl ?? DEFAULT_CUSTOMER_CALLBACK_URL;
  const staleSessionPath = options?.staleSessionPath ?? DEFAULT_STALE_SESSION_PATH;
  const verifyEmailPath = options?.verifyEmailPath ?? DEFAULT_VERIFY_EMAIL_PATH;
  const session = await requireUserSession({
    callbackUrl,
    signInPath: options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH,
  });
  const customerState = await getVerifiedCustomerState(session);

  if (customerState.kind === "stale-session") {
    redirect(withCallback(staleSessionPath, callbackUrl));
  }

  if (customerState.kind === "email-verification-required") {
    redirect(`${verifyEmailPath}?blocked=1&email=${encodeURIComponent(customerState.email)}`);
  }

  if (customerState.kind !== "verified") {
    redirect(withCallback(options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH, callbackUrl));
  }

  return customerState.session;
}

export async function requireAdminSession(options?: {
  signInPath?: string;
  unauthorizedPath?: string;
  throwOnFailure?: boolean;
}): Promise<AdminSession> {
  const auth = await getAuth();
  const session = toAuthenticatedSession(await auth());
  const signInPath = options?.signInPath ?? DEFAULT_ADMIN_SIGN_IN_PATH;
  const unauthorizedPath = options?.unauthorizedPath ?? DEFAULT_ADMIN_UNAUTHORIZED_PATH;

  if (!session) {
    failAuth(Boolean(options?.throwOnFailure), "UNAUTHENTICATED", signInPath);
  }

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      activationStatus: true,
      isActive: true,
    },
  });

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE || !user.isActive) {
    failAuth(Boolean(options?.throwOnFailure), "UNAUTHENTICATED", signInPath);
  }

  if (!isAdminRole(user.role)) {
    failAuth(Boolean(options?.throwOnFailure), "FORBIDDEN", unauthorizedPath);
  }

  return {
    ...session,
    user: {
      ...session.user,
      role: user.role,
    },
  };
}

export async function requireTeacherSession(options?: {
  callbackUrl?: string;
  signInPath?: string;
  unauthorizedPath?: string;
  throwOnFailure?: boolean;
}): Promise<TeacherSession> {
  const callbackUrl = options?.callbackUrl ?? "/teacher";
  const session = await requireUserSession({
    callbackUrl,
    signInPath: options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH,
  });
  const unauthorizedPath = options?.unauthorizedPath ?? "/dashboard";

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, activationStatus: true, isActive: true },
  });

  if (!user || user.activationStatus !== UserActivationStatus.ACTIVE || !user.isActive) {
    failAuth(Boolean(options?.throwOnFailure), "UNAUTHENTICATED", unauthorizedPath);
  }
  if (user.role !== "TEACHER") {
    failAuth(Boolean(options?.throwOnFailure), "FORBIDDEN", unauthorizedPath);
  }

  return {
    ...session,
    user: {
      ...session.user,
      role: "TEACHER",
    },
  };
}

export async function requireStaffSession(options?: {
  callbackUrl?: string;
  signInPath?: string;
  unauthorizedPath?: string;
  throwOnFailure?: boolean;
}): Promise<StaffSession> {
  const callbackUrl = options?.callbackUrl ?? "/kiosk";
  const session = await requireUserSession({
    callbackUrl,
    signInPath: options?.signInPath ?? DEFAULT_CUSTOMER_SIGN_IN_PATH,
  });
  const unauthorizedPath = options?.unauthorizedPath ?? "/dashboard";
  const role = session.user.role;

  if (role !== "TEACHER" && !isAdminRole(role)) {
    failAuth(Boolean(options?.throwOnFailure), "FORBIDDEN", unauthorizedPath);
  }

  return {
    ...session,
    user: {
      ...session.user,
      role: role as StaffSession["user"]["role"],
    },
  };
}

export const requireAuth = requireVerifiedUser;
