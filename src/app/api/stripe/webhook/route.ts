import { processStripeWebhookEvent } from "../../../../lib/public-booking/stripe-webhook-service";
import { verifyStripeWebhookEvent } from "../../../../lib/payments/stripe";

export async function POST(request: Request) {
  console.info("[stripe/webhook] incoming request");
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    console.warn("[stripe/webhook] missing stripe-signature header");
    return Response.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  const payload = await request.text();
  let event: Awaited<ReturnType<typeof verifyStripeWebhookEvent>>;

  try {
    event = verifyStripeWebhookEvent({ payload, signature });
  } catch {
    console.error("[stripe/webhook] signature verification failed");
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  try {
    console.info("[stripe/webhook] verified event", {
      eventId: event.id,
      eventType: event.type,
    });
    await processStripeWebhookEvent(event);
    console.info("[stripe/webhook] processed successfully", {
      eventId: event.id,
      eventType: event.type,
    });
    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[stripe/webhook] processing error", {
        eventId: event.id,
        eventType: event.type,
        error,
      });
    }
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
