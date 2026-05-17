import {
  attemptImmediateLifecycleDispatch,
  enqueueLifecycleEmail,
  ensureLifecycleEmailTemplate,
  STORE_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
} from "@/lib/email/lifecycle-email-outbox-service";

export type StorePurchaseItem = {
  name: string;
  quantity: number;
  unitAmountMinor: number;
  currencyCode: string;
};

export type SendStorePurchaseConfirmationEmailInput = {
  to: string;
  purchaserName: string | null;
  orderId: string;
  items: StorePurchaseItem[];
  idempotencyKey: string;
};

export async function sendStorePurchaseConfirmationEmail(
  input: SendStorePurchaseConfirmationEmailInput,
): Promise<void> {
  const now = new Date();
  await ensureLifecycleEmailTemplate({
    templateKey: STORE_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
    name: "Store Purchase Confirmation",
    category: "STORE",
    subjectTemplate: "Your Studio Purchase Confirmation",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", text: "Purchase Confirmed" },
        { type: "paragraph", text: "{{greeting}}" },
        { type: "paragraph", text: "Thank you for your purchase! Your order is confirmed." },
        { type: "paragraph", text: "Order: {{orderSummaryText}}" },
        { type: "paragraph", text: "Pickup at studio. Please bring this confirmation when you collect your order." },
      ],
    },
  });

  const orderSummaryText = input.items
    .map((item) => {
      const qty = item.quantity > 1 ? ` x${item.quantity}` : "";
      const lineTotal = new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: item.currencyCode,
        minimumFractionDigits: 2,
      }).format((item.unitAmountMinor * item.quantity) / 100);
      return `${item.name}${qty} (${lineTotal})`;
    })
    .join(", ");

  await enqueueLifecycleEmail({
    templateKey: STORE_PURCHASE_CONFIRMATION_TEMPLATE_KEY,
    recipientEmail: input.to,
    payloadJson: {
      deliveryContext: "store-purchase-confirmation",
      greeting: input.purchaserName ? `Hi ${input.purchaserName},` : "Hi there,",
      orderSummaryText,
    },
    idempotencyKey: input.idempotencyKey,
    now,
  });

  await attemptImmediateLifecycleDispatch(now);
}
