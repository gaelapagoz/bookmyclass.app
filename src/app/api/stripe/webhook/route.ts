import { processStripeWebhookEvent } from "../../../../lib/public-booking/stripe-webhook-service";
import { verifyStripeWebhookEvent } from "../../../../lib/payments/stripe";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const payload = await request.text();

  try {
    const event = verifyStripeWebhookEvent({ payload, signature });
    await processStripeWebhookEvent(event);
    return Response.json({ received: true }, { status: 200 });
  } catch {
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }
}
