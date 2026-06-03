import { z } from "zod";
import { auth } from "@/auth";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";
import { validateCart } from "@/lib/cart/cart-service";
import { checkAndRecordDbRateLimit } from "@/lib/security/db-rate-limit";
import { resolveCartCouponPricing } from "@/lib/coupons/coupon-validation-service";

const MAX_RECONCILE_LINES = 50;

const couponValidatePayload = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().trim().min(1),
        priceId: z.string().trim().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .max(MAX_RECONCILE_LINES),
  couponCode: z.string().trim().min(1).max(64),
});

const COUPON_VALIDATE_RATE_LIMIT = { maxAttempts: 10, windowMs: 60 * 1000 } as const;

export async function POST(request: Request) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) return csrfRejection;

  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const userId = session.user.id;

  const rate = await checkAndRecordDbRateLimit("coupon_preview", userId, COUPON_VALIDATE_RATE_LIMIT);
  if (!rate.allowed) {
    return Response.json({ code: "RATE_LIMIT_EXCEEDED", message: "Too many coupon attempts. Please wait." }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST", message: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = couponValidatePayload.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_REQUEST", message: "Invalid coupon payload." }, { status: 400 });
  }

  const validation = await validateCart({ lines: parsed.data.lines, clientId: userId });
  if (!validation.ok) {
    return Response.json({ code: validation.rejection.code ?? "INVALID_CART", message: validation.rejection.message ?? "Cart invalid" }, { status: 400 });
  }

  const pricing = validation.pricing;
  const repricedLines = validation.repricedLines;

  const couponResult = await resolveCartCouponPricing({ userId, couponCode: parsed.data.couponCode, repricedLines, pricing });
  if (!couponResult.ok) {
    return Response.json({ code: couponResult.code, message: couponResult.message }, { status: couponResult.status });
  }

  return Response.json({
    couponCode: couponResult.pricing.coupon?.couponCode ?? null,
    subtotalAmountMinor: couponResult.pricing.subtotalAmountMinor,
    discountAmountMinor: couponResult.pricing.discountAmountMinor,
    totalAmountMinor: couponResult.pricing.totalAmountMinor,
    currencyCode: couponResult.pricing.currencyCode,
    pricedLines: couponResult.pricing.pricedLines,
  });
}
