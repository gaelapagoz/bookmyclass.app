import { requireAuth } from "@/lib/auth/require-auth";
import { getClientOrderHistory } from "@/lib/dashboard/dashboard-service";
import { OrderStatus, ProductType, GiftCardCodeStatus } from "@prisma/client";
import { ResendGiftCardCodeButton } from "./ResendGiftCardCodeButton";
import Image from "next/image";

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
  }).format(new Date(iso));
}

function formatOrderStatus(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PAID: return "Paid";
    case OrderStatus.PLACED: return "Pending";
    case OrderStatus.CANCELLED: return "Cancelled";
    case OrderStatus.REFUNDED: return "Refunded";
    case OrderStatus.DRAFT: return "Draft";
    default: return status;
  }
}

function orderStatusClass(status: OrderStatus): string {
  switch (status) {
    case OrderStatus.PAID: return "text-[#166534]";
    case OrderStatus.CANCELLED:
    case OrderStatus.REFUNDED: return "text-[#7b2d2d]";
    default: return "text-[#8a5959]";
  }
}

function itemTypeLabel(productType: ProductType): string {
  switch (productType) {
    case ProductType.GIFT_CARD: return "Gift Card";
    case ProductType.MERCHANDISE: return "Merchandise";
    case ProductType.DROP_IN_CLASS: return "Drop-in Class";
    case ProductType.CLASS_PACK: return "Class Pack";
    case ProductType.PRIVATE_PACK: return "Private Pack";
    case ProductType.UNLIMITED_MEMBERSHIP: return "Membership";
    default: return productType;
  }
}

function giftCardStatusLabel(status: GiftCardCodeStatus): string {
  switch (status) {
    case GiftCardCodeStatus.ISSUED: return "Not yet redeemed";
    case GiftCardCodeStatus.REDEEMED: return "Redeemed";
    case GiftCardCodeStatus.VOIDED: return "Voided";
    case GiftCardCodeStatus.EXPIRED: return "Expired";
    default: return status;
  }
}

export default async function DashboardOrdersPage() {
  const session = await requireAuth();
  const orders = await getClientOrderHistory(session.user.id);

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Purchases</h1>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
          <p className="text-sm text-[#5f4040]" data-testid="orders-empty">
            No purchases yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-4" data-testid="orders-list">
          {orders.map((order) => (
            <li
              key={order.id}
              className="rounded-xl border border-[#d8cec6] bg-white p-5 space-y-3"
              data-testid="order-item"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs text-[#8a5959]" data-testid="order-date">
                    {formatDate(order.placedAt)}
                  </p>
                  <p className={`mt-1 text-sm font-medium ${orderStatusClass(order.status)}`} data-testid="order-status">
                    {formatOrderStatus(order.status)}
                  </p>
                </div>
                <p className="text-lg font-semibold text-[#6f2b2b]" data-testid="order-total">
                  {formatAmount(order.totalAmountMinor, order.currencyCode)}
                </p>
              </div>

              <ul className="space-y-2 border-t border-[#f0e8e4] pt-2">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="space-y-1"
                    data-testid="order-line-item"
                  >
                    <div className="flex items-center justify-between gap-3 text-sm text-[#5f4040]">
                      <span className="flex min-w-0 items-center gap-2">
                        {item.imageAsset ? (
                          <Image
                            src={item.imageAsset.path}
                            alt={`${item.productNameSnapshot} product image`}
                            width={48}
                            height={48}
                            className="h-12 w-12 shrink-0 rounded-md border border-[#e8dfd9] object-cover"
                          />
                        ) : null}
                        <span className="min-w-0">
                          <span className="mr-1.5 rounded bg-[#f2ede7] px-1.5 py-0.5 text-xs text-[#8a5959]">
                            {itemTypeLabel(item.productType)}
                          </span>
                          {item.productNameSnapshot}
                          {item.quantity > 1 ? (
                            <span className="ml-1 text-[#8a5959]">x {item.quantity}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-xs">
                        {formatAmount(item.lineTotalAmountMinor, item.currencyCode)}
                      </span>
                    </div>

                    {item.productType === ProductType.GIFT_CARD && item.giftCardCode ? (
                      <div
                        className="flex items-center gap-3 rounded bg-[#faf5f2] border border-[#e8dfd9] px-3 py-2 text-xs"
                        data-testid="gift-card-code-row"
                      >
                        <span className="font-mono text-[#3d2020] tracking-wide" data-testid="gift-card-masked">
                          {item.giftCardCode.maskedCode}
                        </span>
                        <span className="text-[#8a5959]" data-testid="gift-card-status">
                          {giftCardStatusLabel(item.giftCardCode.status)}
                        </span>
                        {item.giftCardCode.status === GiftCardCodeStatus.ISSUED ? (
                          <ResendGiftCardCodeButton orderItemId={item.id} />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>

              {order.fulfillmentNote ? (
                <p
                  className="text-xs text-[#8a5959] border-t border-[#f0e8e4] pt-2"
                  data-testid="fulfillment-note"
                >
                  {order.fulfillmentNote}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
