import * as Sentry from "@sentry/nextjs";
import { processStripeWebhookEvent } from "../../../../lib/public-booking/stripe-webhook-service";
import { verifyStripeWebhookEvent } from "../../../../lib/payments/stripe";

function getSafeStripeContext(event: { id: string; type: string; data: { object: unknown } }) {
  const dataObject =
    event.data && typeof event.data === "object" && event.data.object && typeof event.data.object === "object"
      ? (event.data.object as Record<string, unknown>)
      : null;
  const customer = dataObject?.customer;
  return {
    eventId: event.id,
    eventType: event.type,
    checkoutSessionId: typeof dataObject?.id === "string" ? dataObject.id : null,
    customerId:
      typeof customer === "string"
        ? customer
        : customer && typeof customer === "object" && typeof (customer as { id?: unknown }).id === "string"
          ? (customer as { id: string }).id
          : null,
  };
}

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
  } catch (error) {
    Sentry.captureException(error);
    console.error("[stripe/webhook] signature verification failed");
    return Response.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  try {
    const safeContext = getSafeStripeContext(event);
    Sentry.setTag("stripe.event_type", safeContext.eventType);
    Sentry.setTag("stripe.event_id", safeContext.eventId);
    if (safeContext.checkoutSessionId) {
      Sentry.setTag("checkout_session_id", safeContext.checkoutSessionId);
    }
    if (safeContext.customerId) {
      Sentry.setTag("customer_id", safeContext.customerId);
    }

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
    const safeContext = getSafeStripeContext(event);
    Sentry.withScope((scope) => {
      scope.setTag("stripe.event_type", safeContext.eventType);
      scope.setTag("stripe.event_id", safeContext.eventId);
      if (safeContext.checkoutSessionId) {
        scope.setTag("checkout_session_id", safeContext.checkoutSessionId);
      }
      if (safeContext.customerId) {
        scope.setTag("customer_id", safeContext.customerId);
      }
      Sentry.captureException(error);
    });

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
