import { z } from "zod";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { processStripeWebhookEvent } from "@/lib/public-booking/stripe-webhook-service";

const failSchema = z.object({
  checkoutSessionId: z.string().trim().min(1),
  mode: z.enum(["async_failed", "expired"]).optional(),
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

  const parsed = failSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid checkout failure payload." }, { status: 400 });
  }

  const mode = parsed.data.mode ?? "async_failed";
  const event =
    mode === "expired"
      ? {
          id: `evt_e2e_expired_${Date.now()}`,
          type: "checkout.session.expired",
          data: {
            object: {
              id: parsed.data.checkoutSessionId,
              metadata: {},
            },
          },
        }
      : {
          id: `evt_e2e_failed_${Date.now()}`,
          type: "checkout.session.async_payment_failed",
          data: {
            object: {
              id: parsed.data.checkoutSessionId,
              metadata: {},
            },
          },
        };

  await processStripeWebhookEvent(event as never);
  return Response.json({ failed: true, mode }, { status: 200 });
}
