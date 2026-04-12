import { NextRequest } from "next/server";
import prisma from "../../../../../lib/db";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";

export async function POST(request: NextRequest) {
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

  const clientEmail = typeof body === "object" && body !== null ? (body as { clientEmail?: unknown }).clientEmail : null;

  if (!clientEmail || typeof clientEmail !== "string") {
    return Response.json({ error: "clientEmail required" }, { status: 400 });
  }

  const client = await prisma.user.findFirst({
    where: { email: clientEmail },
    select: { id: true },
  });

  if (!client) {
    return Response.json({ error: "Client not found" }, { status: 404 });
  }

  await prisma.booking.deleteMany({
    where: { clientId: client.id },
  });

  return Response.json({ success: true });
}
