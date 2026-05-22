import prisma from "@/lib/db";
import { getAdminLoginAbuseGuardReadiness } from "@/lib/auth/admin-login-abuse-service";
import { validateRuntimeEnvForServer, RuntimeEnvError } from "@/lib/config/runtime-env-server";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    validateRuntimeEnvForServer();
  } catch (error) {
    if (error instanceof RuntimeEnvError) {
      return Response.json(
        { ok: false, db: "unknown", runtimeEnv: error.message, timestamp },
        { status: 503, headers: NO_CACHE_HEADERS },
      );
    }
    throw error;
  }

  const adminLoginAbuseGuard = getAdminLoginAbuseGuardReadiness();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const status = adminLoginAbuseGuard.ready ? 200 : 503;

    return Response.json(
      {
        ok: adminLoginAbuseGuard.ready,
        db: "up",
        adminLoginAbuseGuard,
        timestamp,
      },
      {
        status,
        headers: NO_CACHE_HEADERS,
      },
    );
  } catch (error) {
    console.error("[api/health] database readiness check failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return Response.json(
      {
        ok: false,
        db: "down",
        adminLoginAbuseGuard,
        timestamp,
      },
      {
        status: 503,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
}
