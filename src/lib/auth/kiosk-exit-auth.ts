import type { Session } from "next-auth";
import type { AuthUser } from "@/lib/auth/credentials-authorize";
import { createRateLimiter, type RateLimiter } from "@/lib/security/rate-limit";
import {
  authorizeKioskExitCredentials,
  getSessionForKioskExit,
} from "@/lib/auth/kiosk-exit-auth-deps";

type VerifyPasswordForKioskExitDependencies = {
  getSessionForKioskExit?: () => Promise<Session | null>;
  authorizeKioskExitCredentials?: (email: string, password: string) => Promise<AuthUser | null>;
  rateLimiter?: RateLimiter;
};

// Rate limiting for kiosk exit attempts
const KIOSK_EXIT_RATE_LIMITER: RateLimiter = createRateLimiter({
  maxAttempts: 5, // Allow 5 attempts
  windowMs: 15 * 60 * 1000, // Within 15 minutes
  blockDurationMs: 30 * 60 * 1000, // Block for 30 minutes
});

/**
 * Verifies the password for kiosk exit against the currently authenticated staff user.
 * This provides secure re-authentication before allowing exit from kiosk mode.
 */
export async function verifyPasswordForKioskExit(
  password: string,
  dependencies?: VerifyPasswordForKioskExitDependencies,
): Promise<boolean> {
  try {
    const session = await (dependencies?.getSessionForKioskExit ?? getSessionForKioskExit)();

    if (!session?.user?.id || !session.user.email) {
      return false;
    }

    // Check rate limit
    const rateLimitKey = `kiosk-exit:${session.user.id}`;
    const rateLimitResult = (dependencies?.rateLimiter ?? KIOSK_EXIT_RATE_LIMITER).checkLimit(rateLimitKey);

    if (!rateLimitResult.allowed) {
      throw new Error("RATE_LIMITED");
    }

    // Verify the password using the same logic as login
    const user = await (dependencies?.authorizeKioskExitCredentials ?? authorizeKioskExitCredentials)(
      session.user.email,
      password,
    );

    if (user === null) {
      // Record failed attempt
      KIOSK_EXIT_RATE_LIMITER.recordFailure(rateLimitKey);
      return false;
    }

    // Success - reset rate limit counter
    KIOSK_EXIT_RATE_LIMITER.reset(rateLimitKey);
    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMITED") {
      throw error;
    }
    console.error("Kiosk exit password verification error:", error);
    return false;
  }
}