import { z } from "zod";
import { Role, UserCreatedVia } from "@prisma/client";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { hashPassword } from "@/lib/auth/password-service";
import { createUserFromTrustedFlow } from "@/lib/auth/user-identity-service";

const payloadSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
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

  const passwordHash = await hashPassword(parsed.data.password);

  await createUserFromTrustedFlow({
    firstName: "Test",
    lastName: "User",
    email: parsed.data.email,
    passwordHash,
    role: Role.CLIENT,
    createdVia: UserCreatedVia.PUBLIC_SIGNUP,
    markEmailVerified: true,
  });

  return Response.json({ email: parsed.data.email, created: true }, { status: 200 });
}
