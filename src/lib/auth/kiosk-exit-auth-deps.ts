import type { Session } from "next-auth";
import type { AuthUser } from "@/lib/auth/credentials-authorize";

export async function getSessionForKioskExit(): Promise<Session | null> {
  const { auth } = await import("@/auth");
  return auth();
}

export async function authorizeKioskExitCredentials(
  email: string,
  password: string,
): Promise<AuthUser | null> {
  const { authorizeCredentials } = await import("@/lib/auth/credentials-authorize");
  return authorizeCredentials({ email, password });
}
