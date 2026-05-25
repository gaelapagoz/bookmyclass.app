import { z } from "zod";
import { completeStripeCheckoutSessionForE2ETests } from "@/lib/public-booking/stripe-webhook-service";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";

const completeSchema = z.object({
  checkoutSessionId: z.string().trim().min(1),
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

  const parsed = completeSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid checkout payload." }, { status: 400 });
  }

  const result = await completeStripeCheckoutSessionForE2ETests({
    checkoutSessionId: parsed.data.checkoutSessionId,
  });

  return Response.json(result, { status: result.completed ? 200 : 422 });
}
