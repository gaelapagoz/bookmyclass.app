import Link from "next/link";
import { CartClearOnSuccess } from "@/components/cart/CartClearOnSuccess";
import { requireAuth } from "@/lib/auth/require-auth";
import {
  getCartCheckoutSuccessState,
  getCartCheckoutSuccessStateForOrder,
} from "@/lib/cart/cart-success-state";
import { reconcileCatalogCheckoutSessionAfterReturn } from "@/lib/public-booking/stripe-webhook-service";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function renderAmount(minor: number | null, currencyCode: string | null): string {
  if (minor === null || !currencyCode) {
    return "N/A";
  }

  return formatAmount(minor, currencyCode);
}

export default async function SubscriptionSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; productId?: string; session_id?: string }>;
}) {
  const session = await requireAuth();
  const { orderId, productId, session_id } = await searchParams;
  const checkoutSessionId = session_id?.trim() || null;
  const successOrderId = orderId?.trim() || null;

  if (checkoutSessionId) {
    try {
      await reconcileCatalogCheckoutSessionAfterReturn({
        checkoutSessionId,
        userId: session.user.id,
        productId,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[subscription/success] manual reconciliation failed", {
          sessionId: checkoutSessionId,
          productId,
          error,
        });
      }
    }
  }

  const successState = checkoutSessionId
    ? await getCartCheckoutSuccessState({
        checkoutSessionId,
        userId: session.user.id,
      })
    : successOrderId
      ? await getCartCheckoutSuccessStateForOrder({
          orderId: successOrderId,
          userId: session.user.id,
        })
      : null;

  const heading =
    successState?.reconciliationState === "CONFIRMED"
      ? "Payment Confirmed"
      : successState?.reconciliationState === "FAILED"
        ? "Payment Failed"
        : "Payment Processing";

  const statusMessage =
    successState?.reconciliationState === "CONFIRMED"
      ? "Your purchase is confirmed and rendered from server-reconciled order data."
      : successState?.reconciliationState === "FAILED"
        ? "Your checkout did not complete successfully. Please retry from your cart."
        : "We are still reconciling your payment. Refresh in a few seconds.";
  const clearKey = checkoutSessionId ?? successOrderId ?? null;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">{heading}</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">{statusMessage}</p>
      <CartClearOnSuccess
        checkoutSessionId={clearKey}
        cartClearEligible={Boolean(successState?.cartClearEligible)}
        purchasedLines={
          successState?.items.map((item) => ({
            productId: item.productId,
            priceId: item.priceId,
            quantity: item.quantity,
          })) ?? []
        }
      />

      {successState ? (
        <div className="mt-5 space-y-4 rounded-xl border border-[#d8cec6] bg-white p-4">
          <h2 className="text-lg font-semibold text-[#6f2b2b]">Order Summary</h2>

          <dl className="grid grid-cols-1 gap-2 text-sm text-[#5f4040] md:grid-cols-2">
            <div className="flex justify-between gap-3 md:block">
              <dt className="font-medium">Payment Status</dt>
              <dd>{successState.paymentStatus ?? "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-3 md:block">
              <dt className="font-medium">Order Status</dt>
              <dd>{successState.orderStatus ?? "N/A"}</dd>
            </div>
            <div className="flex justify-between gap-3 md:block">
              <dt className="font-medium">Reconciliation</dt>
              <dd>{successState.reconciliationState}</dd>
            </div>
          </dl>

          {successState.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-[#5f4040]">
                <thead>
                  <tr className="border-b border-[#e7ddd5] text-xs uppercase tracking-wide text-[#7f5a5a]">
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4">Unit</th>
                    <th className="py-2 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody>
                  {successState.items.map((item, index) => (
                    <tr key={`${item.productNameSnapshot}-${item.priceNameSnapshot}-${index}`} className="border-b border-[#f1e7df]">
                      <td className="py-2 pr-4">{item.productNameSnapshot}</td>
                      <td className="py-2 pr-4">{item.priceNameSnapshot}</td>
                      <td className="py-2 pr-4">{item.quantity}</td>
                      <td className="py-2 pr-4">{formatAmount(item.unitAmountMinor, item.currencyCode)}</td>
                      <td className="py-2 text-right">{formatAmount(item.lineTotalAmountMinor, item.currencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[#7f5a5a]">No order items found for this checkout session.</p>
          )}

          <div className="space-y-1 text-sm text-[#5f4040]">
            <p>
              <span className="font-medium">Subtotal:</span>{" "}
              {renderAmount(successState.subtotalAmountMinor, successState.currencyCode)}
            </p>
            {successState.couponCodeSnapshot ? (
              <p>
                <span className="font-medium">Coupon ({successState.couponCodeSnapshot}):</span>{" "}
                -{renderAmount(successState.discountAmountMinor, successState.currencyCode)}
              </p>
            ) : null}
            {successState.loyaltyCreditAmountMinor > 0 && successState.currencyCode ? (
              <p>
                <span className="font-medium">Loyalty Credit:</span>{" "}
                -{formatAmount(successState.loyaltyCreditAmountMinor, successState.currencyCode)}
              </p>
            ) : null}
            {successState.walletAmountMinor > 0 && successState.currencyCode ? (
              <p>
                <span className="font-medium">Gift Card Wallet:</span>{" "}
                -{formatAmount(successState.walletAmountMinor, successState.currencyCode)}
              </p>
            ) : null}
            {successState.stripePaidAmountMinor > 0 && successState.currencyCode ? (
              <p>
                <span className="font-medium">Stripe/Card Remainder:</span>{" "}
                {formatAmount(successState.stripePaidAmountMinor, successState.currencyCode)}
              </p>
            ) : null}
            <p>
              <span className="font-medium">Order Total:</span>{" "}
              {renderAmount(successState.totalAmountMinor, successState.currencyCode)}
            </p>
            <p>
              <span className="font-medium">Total Paid:</span>{" "}
              {renderAmount(successState.totalPaidAmountMinor, successState.currencyCode)}
            </p>
            {successState.hasZeroValuePayment ? (
              <p>
                <span className="font-medium">Payment Record:</span> Internal zero-value payment recorded
              </p>
            ) : null}
            {successState.stripeCheckoutSessionId ? (
              <p>
                <span className="font-medium">Stripe Session:</span> {successState.stripeCheckoutSessionId}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
