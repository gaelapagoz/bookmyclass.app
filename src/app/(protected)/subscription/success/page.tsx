import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { reconcileCatalogCheckoutSessionAfterReturn } from "@/lib/public-booking/stripe-webhook-service";

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ productId?: string; session_id?: string }>;
}) {
  const session = await requireAuth();
  const { productId, session_id } = await searchParams;

  if (session_id) {
    try {
      await reconcileCatalogCheckoutSessionAfterReturn({
        checkoutSessionId: session_id,
        userId: session.user.id,
        productId,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[subscription/success] manual reconciliation failed", {
          sessionId: session_id,
          productId,
          error,
        });
      }
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">Paymented Confirmed</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">
        Your subscription payment is confirmed, and you are now ready to book a class.
      </p>
      <p className="mt-2 text-sm text-[#7f5a5a]">
        You can start booking right away from the class schedule, and your active plan will be available in your membership dashboard.
      </p>

      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/dashboard/membership"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Go to Membership
        </Link>
        <Link
          href="/subscription"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to products
        </Link>
      </div>
    </section>
  );
}
