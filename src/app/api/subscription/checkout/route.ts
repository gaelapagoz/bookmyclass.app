import { z } from "zod";
import { auth } from "@/auth";
import { CatalogCheckoutError, createCheckoutSessionForCatalogProduct } from "@/lib/public-booking/checkout-service";
import { getStripeEnv } from "@/lib/payments/stripe";

const checkoutSchema = z.object({
  productId: z.string().cuid("Invalid productId."),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid productId." }, { status: 400 });
  }

  const appUrl = getStripeEnv().appUrl;

  try {
    const checkoutSession = await createCheckoutSessionForCatalogProduct({
      userId: session.user.id,
      productId: parsed.data.productId,
      successUrl: `${appUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/subscription/cancel`,
    });

    return Response.json(
      {
        checkoutUrl: checkoutSession.checkoutUrl,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof CatalogCheckoutError) {
      const status =
        error.code === "PRODUCT_NOT_FOUND"
          ? 404
          : error.code === "AUTH_REQUIRED"
            ? 401
            : 409;
      return Response.json({ error: error.message }, { status });
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[subscription/checkout] unexpected error", error);
    }
    return Response.json(
      {
        error: "Could not start checkout.",
      },
      { status: 500 },
    );
  }
}
