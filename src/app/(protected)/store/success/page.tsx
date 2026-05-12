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

export default async function StoreSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string; session_id?: string }>;
}) {
  const session = await requireAuth();
  const { orderId, session_id } = await searchParams;
  const checkoutSessionId = session_id?.trim() || null;
  const successOrderId = orderId?.trim() || null;

  if (checkoutSessionId) {
    try {
      await reconcileCatalogCheckoutSessionAfterReturn({
        checkoutSessionId,
        userId: session.user.id,
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[store/success] manual reconciliation failed", {
          sessionId: checkoutSessionId,
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
      ? "Purchase Confirmed"
      : successState?.reconciliationState === "FAILED"
        ? "Purchase Failed"
        : "Purchase Processing";

  const statusMessage =
    successState?.reconciliationState === "CONFIRMED"
      ? "Your order is confirmed."
      : successState?.reconciliationState === "FAILED"
        ? "Your checkout did not complete. Please retry from your cart."
        : "We are processing your order. Refresh in a few seconds.";

  const showGiftCardCopy =
    successState?.reconciliationState === "CONFIRMED" && successState.hasGiftCardItems;

  const clearKey = checkoutSessionId ?? successOrderId ?? null;

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">{heading}</h1>
      <p className="mt-3 text-sm text-[#7f5a5a]">{statusMessage}</p>

      {showGiftCardCopy ? (
        <div className="mt-4 rounded-xl border border-[#d8cec6] bg-[#faf5f2] p-4 space-y-1" data-testid="gift-card-success-copy">
          <p className="text-sm text-[#5f4040]">
            Your gift card code has been sent to your email.
          </p>
          <p className="text-sm text-[#5f4040]">
            Use the code to add funds to your wallet from the Dashboard.
          </p>
        </div>
      ) : null}

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
          </dl>

          {successState.items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm text-[#5f4040]">
                <thead>
                  <tr className="border-b border-[#e7ddd5] text-xs uppercase tracking-wide text-[#7f5a5a]">
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {successState.items.map((item, index) => (
                    <tr
                      key={`${item.productNameSnapshot}-${item.priceNameSnapshot}-${index}`}
                      className="border-b border-[#f1e7df]"
                    >
                      <td className="py-2 pr-4">{item.productNameSnapshot}</td>
                      <td className="py-2 pr-4">{item.quantity}</td>
                      <td className="py-2 text-right">
                        {formatAmount(item.lineTotalAmountMinor, item.currencyCode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[#7f5a5a]">No order items found.</p>
          )}

          {successState.totalAmountMinor !== null && successState.currencyCode ? (
            <p className="text-sm text-[#5f4040]">
              <span className="font-medium">Total:</span>{" "}
              {formatAmount(successState.totalAmountMinor, successState.currencyCode)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-4">
        <Link
          href="/dashboard/wallet"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          View Wallet Balance
        </Link>
        <Link
          href="/store"
          className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
        >
          Back to Store
        </Link>
      </div>
    </section>
  );
}
