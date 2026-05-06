import { z } from "zod";
import { auth } from "@/auth";
import { reconcileCart } from "@/lib/cart/cart-service";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

const MAX_RECONCILE_LINES = 50;
const MAX_CART_ID_LENGTH = 128;

const reconcilePayloadSchema = z.object({
  lines: z.array(
    z.object({
      productId: z.string().trim().min(1).max(MAX_CART_ID_LENGTH),
      priceId: z.string().trim().min(1).max(MAX_CART_ID_LENGTH),
      quantity: z.number().int().min(1),
    }),
  ).max(MAX_RECONCILE_LINES),
});

export async function POST(request: Request) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return csrfRejection;
  }

  // Intentionally authenticated: prevents unauthenticated catalog pricing enumeration.
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST", message: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = reconcilePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_REQUEST", message: "Invalid cart payload." }, { status: 400 });
  }

  const result = await reconcileCart({ lines: parsed.data.lines });

  return Response.json({
    cartHash: result.cartHash,
    lines: result.repricedLines,
    removedCount: result.removedLines.length,
    removedLines: result.removedLines,
  });
}
