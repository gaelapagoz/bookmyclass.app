import {
  attemptImmediateLifecycleDispatch,
  enqueueLifecycleEmail,
  ensureLifecycleEmailTemplate,
  GIFT_CARD_ISSUANCE_TEMPLATE_KEY,
} from "@/lib/email/lifecycle-email-outbox-service";
import { GIFT_CARD_CURRENCY_CODE } from "@/lib/gift-cards/gift-card-types";

export type SendGiftCardIssuanceEmailInput = {
  to: string;
  purchaserName: string | null;
  plaintextCode: string;
  amountMinor: number;
  currencyCode?: string;
  recipientName?: string | null;
  adminMessage?: string | null;
  idempotencyKey: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendGiftCardIssuanceEmail(input: SendGiftCardIssuanceEmailInput): Promise<void> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  const now = new Date();

  await ensureLifecycleEmailTemplate({
    templateKey: GIFT_CARD_ISSUANCE_TEMPLATE_KEY,
    name: "Gift Card Issuance",
    category: "GIFT_CARD",
    subjectTemplate: "Your gift card code",
    bodyTemplateJson: {
      blocks: [
        { type: "paragraph", text: "Your gift card code" },
        { type: "paragraph", text: "{{greeting}}" },
        { type: "paragraph", text: "Your {{amountFormatted}} gift card code is below." },
        { type: "paragraph", text: "{{plaintextCode}}" },
        { type: "paragraph", text: "{{escapedAdminMessage}}" },
        { type: "paragraph", text: "To redeem this code, sign in and go to Dashboard -> Wallet." },
        { type: "paragraph", text: "Keep this code safe - it can only be used once." },
      ],
    },
  });

  const greetingName = input.recipientName ?? input.purchaserName;
  const greeting = greetingName ? `Hi ${greetingName},` : "Hi there,";
  const amountFormatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(input.amountMinor / 100);
  const escapedAdminMessage = input.adminMessage?.trim()
    ? escapeHtml(input.adminMessage.trim()).replaceAll("\n", "&lt;br /&gt;")
    : "";

  await enqueueLifecycleEmail({
    templateKey: GIFT_CARD_ISSUANCE_TEMPLATE_KEY,
    recipientEmail: input.to,
    payloadJson: {
      deliveryContext: "gift-card-issuance",
      greeting,
      amountFormatted,
      plaintextCode: input.plaintextCode,
      escapedAdminMessage,
    },
    idempotencyKey: input.idempotencyKey,
    now,
  });

  await attemptImmediateLifecycleDispatch(now);
}
