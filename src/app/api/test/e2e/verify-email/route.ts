import { z } from "zod";
import { verifyPendingRegistrationByEmailForTests } from "@/lib/auth/user-identity-service";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";

const verifySchema = z.object({
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

  const parsed = verifySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid email payload." }, { status: 400 });
  }

  const result = await verifyPendingRegistrationByEmailForTests({
    email: parsed.data.email,
  });

  return Response.json({ verified: result.verified, email: result.email }, { status: 200 });
}
