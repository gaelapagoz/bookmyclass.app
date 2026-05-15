import { Role } from "@prisma/client";
import { ZodError } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { generateAdminGiftCardCode } from "@/lib/gift-cards/gift-card-code-service";

type CreateCodeBody = {
  idempotencyKey?: string;
  amountMinor?: number;
  recipientEmail?: string;
  recipientName?: string | null;
  adminMessage?: string | null;
  adminReason?: string;
  expiresAt?: string | null;
  currencyCode?: string;
};

export async function POST(request: Request) {
  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession({ throwOnFailure: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHENTICATED";
    return Response.json({ code }, { status: code === "FORBIDDEN" ? 403 : 401 });
  }

  let body: CreateCodeBody;
  try {
    body = await request.json() as CreateCodeBody;
  } catch {
    return Response.json({ code: "INVALID_JSON_BODY" }, { status: 400 });
  }

  try {
    const created = await generateAdminGiftCardCode({
      actor: { userId: session.user.id, role: session.user.role as Role },
      idempotencyKey: String(body.idempotencyKey ?? ""),
      amountMinor: Number(body.amountMinor),
      recipientEmail: String(body.recipientEmail ?? ""),
      recipientName: body.recipientName ?? null,
      adminMessage: body.adminMessage ?? null,
      adminReason: String(body.adminReason ?? ""),
      expiresAt: body.expiresAt ?? null,
      currencyCode: body.currencyCode,
    });
    return Response.json(created, { status: 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_ADMIN_GENERATE_FAILED";
    if (code === "UNAUTHENTICATED") {
      return Response.json({ code }, { status: 401 });
    }
    if (code === "FORBIDDEN" || code === "GIFT_CARD_ADMIN_ACTOR_FORBIDDEN") {
      return Response.json({ code }, { status: 403 });
    }
    if (code === "GIFT_CARD_ADMIN_IDEMPOTENCY_PAYLOAD_MISMATCH") {
      return Response.json({ code }, { status: 409 });
    }
    if (code === "GIFT_CARD_ADMIN_EMAIL_DELIVERY_FAILED") {
      return Response.json({ code }, { status: 502 });
    }
    if (
      code === "GIFT_CARD_EXPIRY_IN_PAST" ||
      error instanceof ZodError
    ) {
      return Response.json({ code }, { status: 422 });
    }

    return Response.json({ code }, { status: 400 });
  }
}
