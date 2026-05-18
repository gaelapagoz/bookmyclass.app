import {
  attemptImmediateLifecycleDispatch,
  enqueueLifecycleEmail,
  ensureLifecycleEmailTemplate,
  PAYMENT_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
} from "@/lib/email/lifecycle-email-outbox-service";

export type PurchaseConfirmationItem = {
  name: string;
  quantity: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
};

export type SendPurchaseConfirmationEmailInput = {
  to: string;
  purchaserName: string | null;
  orderId: string;
  items: PurchaseConfirmationItem[];
  totalAmountMinor: number;
  currencyCode: string;
  walletAmountMinor: number;
  stripeAmountMinor: number;
  idempotencyKey?: string;
};

function derivePurchaseConfirmationIdempotencyKey(input: SendPurchaseConfirmationEmailInput): string {
  const explicit = input.idempotencyKey?.trim();
  if (explicit) {
    return explicit;
  }
  return `payment:purchase-confirmation:${input.orderId}`;
}

export async function sendPurchaseConfirmationEmail(
  input: SendPurchaseConfirmationEmailInput,
): Promise<void> {
  const now = new Date();
  await ensureLifecycleEmailTemplate({
    templateKey: PAYMENT_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
    name: "Payment Purchase Confirmation",
    category: "PAYMENT",
    subjectTemplate: "Your Studio Purchase Confirmation",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", text: "Purchase Confirmed" },
        { type: "paragraph", text: "{{greeting}}" },
        {
          type: "paragraph",
          text: "Your purchase is confirmed. Your credits and entitlements are now active in your account.",
        },
        { type: "paragraph", text: "Order: {{orderSummaryText}}" },
        { type: "paragraph", text: "Total: {{totalAmountFormatted}}" },
        { type: "paragraph", text: "{{walletAmountLine}}" },
        { type: "paragraph", text: "{{stripeAmountLine}}" },
        {
          type: "paragraph",
          text: "View your credits and active plans in Dashboard > Membership & Credits.",
        },
      ],
    },
  });

  const orderSummaryText = input.items
    .map((item) => {
      const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
      return `${item.name}${qty}`;
    })
    .join(", ");

  await enqueueLifecycleEmail({
    templateKey: PAYMENT_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
    recipientEmail: input.to,
    payloadJson: {
      deliveryContext: "purchase-confirmation",
      greeting: input.purchaserName ? `Hi ${input.purchaserName},` : "Hi there,",
      orderSummaryText,
      totalAmountFormatted: new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: input.currencyCode,
        minimumFractionDigits: 2,
      }).format(input.totalAmountMinor / 100),
      walletAmountLine:
        input.walletAmountMinor > 0
          ? `Wallet credit applied: -${new Intl.NumberFormat("en-GB", {
              style: "currency",
              currency: input.currencyCode,
              minimumFractionDigits: 2,
            }).format(input.walletAmountMinor / 100)}`
          : "",
      stripeAmountLine:
        input.stripeAmountMinor > 0
          ? `Paid by card: ${new Intl.NumberFormat("en-GB", {
              style: "currency",
              currency: input.currencyCode,
              minimumFractionDigits: 2,
            }).format(input.stripeAmountMinor / 100)}`
          : "",
    },
    idempotencyKey: derivePurchaseConfirmationIdempotencyKey(input),
    now,
  });

  await attemptImmediateLifecycleDispatch(now);
}
