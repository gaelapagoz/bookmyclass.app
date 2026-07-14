import { z } from "zod";

import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { prisma } from "@/lib/db";

const payloadSchema = z.object({
  email: z.string().trim().email(),
});

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  await prisma.$transaction([
    prisma.pendingUserRegistration.deleteMany({ where: { email } }),
    prisma.verificationToken.deleteMany({ where: { identifier: email } }),
    prisma.publicAuthRateLimit.deleteMany(),
  ]);

  return Response.json({ prepared: true }, { status: 200 });
}
