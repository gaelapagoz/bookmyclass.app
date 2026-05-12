import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { getClientStoreOrderHistory } from "@/lib/dashboard/dashboard-service";
import { OrderStatus, ProductType } from "@prisma/client";

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
    default: return productType;
  }
}

export default async function DashboardOrdersPage() {
  const session = await requireAuth();
  const orders = await getClientStoreOrderHistory(session.user.id);

  return (
    <section className="space-y-6">
      <h1 className="text-3xl font-semibold text-[#6f2b2b]">My Purchases</h1>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-[#d8cec6] bg-white p-5">
          <p className="text-sm text-[#5f4040]" data-testid="orders-empty">
            No Store purchases yet.
          </p>
          <Link
            href="/store"
            className="mt-3 inline-block text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          >
            Visit the Store
          </Link>
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

              <ul className="space-y-1 border-t border-[#f0e8e4] pt-2">
                {order.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between text-sm text-[#5f4040]"
                    data-testid="order-line-item"
                  >
                    <span>
                      <span className="mr-1.5 rounded bg-[#f2ede7] px-1.5 py-0.5 text-xs text-[#8a5959]">
                        {itemTypeLabel(item.productType)}
                      </span>
                      {item.productNameSnapshot}
                      {item.quantity > 1 ? (
                        <span className="ml-1 text-[#8a5959]">× {item.quantity}</span>
                      ) : null}
                    </span>
                    <span className="font-mono text-xs">
                      {formatAmount(item.lineTotalAmountMinor, item.currencyCode)}
                    </span>
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
