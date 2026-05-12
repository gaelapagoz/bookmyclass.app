import { z } from "zod";
import { auth } from "@/auth";
import { validateCartSuccessAccess } from "@/lib/cart/cart-success-state";

const successValidationQuerySchema = z.object({
  orderId: z.string().trim().min(1).optional(),
  session_id: z.string().trim().min(1).optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = successValidationQuerySchema.safeParse({
    orderId: url.searchParams.get("orderId") ?? undefined,
    session_id: url.searchParams.get("session_id") ?? undefined,
  });

  if (!parsed.success || (!parsed.data.orderId && !parsed.data.session_id)) {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  const result = await validateCartSuccessAccess({
    orderId: parsed.data.orderId,
    checkoutSessionId: parsed.data.session_id,
    userId: session.user.id,
  });

  if (!result.ok) {
    return Response.json({ code: result.code }, { status: result.status });
  }

  return Response.json({
    orderId: result.orderId,
    checkoutSessionId: result.checkoutSessionId,
  });
}
