import { isDeterministicEmailDeliveryMode, sendEmailViaResend } from "@/lib/email/resend-delivery";
import { GIFT_CARD_CURRENCY_CODE } from "@/lib/gift-cards/gift-card-types";

export type SendGiftCardIssuanceEmailInput = {
  to: string;
  purchaserName: string | null;
  plaintextCode: string;
  amountMinor: number;
  currencyCode?: string;
};

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export async function sendGiftCardIssuanceEmail(input: SendGiftCardIssuanceEmailInput): Promise<void> {
  const currencyCode = input.currencyCode ?? GIFT_CARD_CURRENCY_CODE;
  const from =
    process.env.EMAIL_FROM?.trim() ||
    (isDeterministicEmailDeliveryMode() ? "Studio <no-reply@test.local>" : "");
  if (!from) {
    throw new Error("Missing EMAIL_FROM.");
  }

  const greeting = input.purchaserName ? `Hi ${input.purchaserName},` : "Hi there,";
  const amountFormatted = formatAmount(input.amountMinor, currencyCode);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#faf5f2;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e8dfd9">
    <h1 style="color:#6f2b2b;font-size:20px;margin:0 0 16px">Your Gift Card is Ready</h1>
    <p style="color:#5f4040;font-size:14px;margin:0 0 12px">${greeting}</p>
    <p style="color:#5f4040;font-size:14px;margin:0 0 20px">
      Thank you for your purchase. Your <strong>${amountFormatted}</strong> gift card code is below.
    </p>
    <div style="background:#faf5f2;border:1px solid #d8cec6;border-radius:8px;padding:16px;text-align:center;margin:0 0 20px">
      <p style="font-family:monospace;font-size:18px;font-weight:bold;color:#3d2020;letter-spacing:0.05em;margin:0;word-break:break-all">
        ${input.plaintextCode}
      </p>
    </div>
    <p style="color:#5f4040;font-size:13px;margin:0 0 8px">
      To redeem this code, sign in to your account and go to <strong>Dashboard → Wallet</strong>.
    </p>
    <p style="color:#8a5959;font-size:12px;margin:0">Keep this code safe — it can only be used once.</p>
  </div>
</body>
</html>`.trim();

  await sendEmailViaResend({
    to: input.to,
    from,
    subject: `Your ${amountFormatted} Studio Gift Card`,
    html,
    context: "gift-card-issuance",
  });
}
