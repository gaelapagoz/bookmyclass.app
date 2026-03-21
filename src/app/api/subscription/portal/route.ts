import { auth } from "@/auth";
import { createSubscriptionBillingPortalSession, getAppUrlFromStripeEnv } from "@/lib/stripe";
import { getLatestStripeCustomerIdForUser } from "@/lib/subscription/ownership";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const stripeCustomerId = await getLatestStripeCustomerIdForUser(session.user.id);
  if (!stripeCustomerId) {
    return Response.json(
      {
        error: "No Stripe billing profile found yet. Complete a Stripe checkout first.",
      },
      { status: 409 },
    );
  }

  const appUrl = getAppUrlFromStripeEnv();
  const portalSession = await createSubscriptionBillingPortalSession({
    customerId: stripeCustomerId,
    returnUrl: `${appUrl}/dashboard/membership`,
  });

  if (!portalSession.url) {
    return Response.json({ error: "Could not create billing portal session." }, { status: 500 });
  }

  return Response.json({ portalUrl: portalSession.url }, { status: 200 });
}

