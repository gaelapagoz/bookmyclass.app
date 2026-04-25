import { UserActivationStatus } from "@prisma/client";

import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null ? (body as { email?: unknown }).email : null;

  if (!email || typeof email !== "string") {
    return Response.json({ error: "email required" }, { status: 400 });
  }

  const updated = await prisma.user.updateMany({
    where: { email },
    data: {
      activationStatus: UserActivationStatus.ACTIVE,
      isActive: true,
    },
  });

  if (updated.count < 1) {
    return Response.json({ error: "User not found." }, { status: 404 });
  }

  return Response.json({ reactivated: true }, { status: 200 });
}
