import { isDeterministicEmailDeliveryMode, sendEmailViaResend } from "@/lib/email/resend-delivery";

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
};

function formatAmount(minor: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export async function sendStorePurchaseConfirmationEmail(
  input: SendStorePurchaseConfirmationEmailInput,
): Promise<void> {
  const from =
    process.env.EMAIL_FROM?.trim() ||
    (isDeterministicEmailDeliveryMode() ? "Studio <no-reply@test.local>" : "");
  if (!from) {
    throw new Error("Missing EMAIL_FROM.");
  }

  const greeting = input.purchaserName ? `Hi ${input.purchaserName},` : "Hi there,";

  const itemRows = input.items
    .map((item) => {
      const lineTotal = formatAmount(item.unitAmountMinor * item.quantity, item.currencyCode);
      const qty = item.quantity > 1 ? ` × ${item.quantity}` : "";
      return `<tr>
        <td style="padding:8px 0;color:#5f4040;font-size:13px">${item.name}${qty}</td>
        <td style="padding:8px 0;color:#5f4040;font-size:13px;text-align:right">${lineTotal}</td>
      </tr>`;
    })
    .join("\n");

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#faf5f2;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e8dfd9">
    <h1 style="color:#6f2b2b;font-size:20px;margin:0 0 16px">Purchase Confirmed</h1>
    <p style="color:#5f4040;font-size:14px;margin:0 0 12px">${greeting}</p>
    <p style="color:#5f4040;font-size:14px;margin:0 0 20px">
      Thank you for your purchase! Your order is confirmed.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px">
      <thead>
        <tr style="border-bottom:1px solid #e8dfd9">
          <th style="padding:8px 0;color:#8a5959;font-size:11px;text-transform:uppercase;text-align:left">Item</th>
          <th style="padding:8px 0;color:#8a5959;font-size:11px;text-transform:uppercase;text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>
    <p style="color:#8a5959;font-size:12px;margin:0">
      Pickup at studio. Please bring this confirmation when you collect your order.
    </p>
  </div>
</body>
</html>`.trim();

  await sendEmailViaResend({
    to: input.to,
    from,
    subject: "Your Studio Purchase Confirmation",
    html,
    context: "store-purchase-confirmation",
  });
}
