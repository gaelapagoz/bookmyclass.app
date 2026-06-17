import { UserActivationStatus, type Role } from "@prisma/client";
import type { Session } from "next-auth";

export const VERIFIED_CUSTOMER_STALE_SESSION_PATH = "/auth/stale-session";

export type AuthenticatedSession = Session & {
  user: NonNullable<Session["user"]> & {
    id: string;
    role?: Role;
  };
};

export type VerifiedCustomerState =
  | { kind: "signed-out" }
  | { kind: "stale-session"; reason: "missing-user" | "inactive-user" | "db-error" }
  | { kind: "email-verification-required"; email: string }
  | { kind: "verified"; session: AuthenticatedSession };

export function toAuthenticatedSession(session: Session | null): AuthenticatedSession | null {
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

export async function getVerifiedCustomerState(
  session: Session | null,
): Promise<VerifiedCustomerState> {
  const authenticatedSession = toAuthenticatedSession(session);

  if (!authenticatedSession) {
    return { kind: "signed-out" };
  }

  try {
    const { prisma } = await import("@/lib/db");
    const user = await prisma.user.findUnique({
      where: { id: authenticatedSession.user.id },
      select: {
        email: true,
        emailVerified: true,
        activationStatus: true,
        isActive: true,
        role: true,
      },
    });

    if (!user) {
      return { kind: "stale-session", reason: "missing-user" };
    }

    if (user.activationStatus !== UserActivationStatus.ACTIVE || !user.isActive) {
      return { kind: "stale-session", reason: "inactive-user" };
    }

    if (user.role === "CLIENT" && !user.emailVerified) {
      return {
        kind: "email-verification-required",
        email: user.email,
      };
    }

    return {
      kind: "verified",
      session: {
        ...authenticatedSession,
        user: {
          ...authenticatedSession.user,
          role: user.role,
        },
      },
    };
  } catch {
    return { kind: "stale-session", reason: "db-error" };
  }
}
