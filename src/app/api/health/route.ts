import prisma from "@/lib/db";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
};

export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json(
      {
        ok: true,
        db: "up",
        timestamp,
      },
      {
        status: 200,
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
        timestamp,
      },
      {
        status: 503,
        headers: NO_CACHE_HEADERS,
      },
    );
  }
}
