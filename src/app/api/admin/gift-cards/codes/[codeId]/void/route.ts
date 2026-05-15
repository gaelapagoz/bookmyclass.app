import { Role } from "@prisma/client";

import { requireAdminSession } from "@/lib/auth/require-auth";
import { voidGiftCardCode } from "@/lib/gift-cards/gift-card-code-service";

type VoidCodeBody = {
  reason?: string;
};

export async function POST(request: Request, context: { params: Promise<{ codeId: string }> }) {
  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession({ throwOnFailure: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHENTICATED";
    return Response.json({ code }, { status: code === "FORBIDDEN" ? 403 : 401 });
  }

  const { codeId } = await context.params;

  let body: VoidCodeBody;
  try {
    body = await request.json() as VoidCodeBody;
  } catch {
    return Response.json({ code: "INVALID_JSON_BODY" }, { status: 400 });
  }

  try {
    const result = await voidGiftCardCode({
      codeId,
      actor: { userId: session.user.id, role: session.user.role as Role },
      reason: String(body.reason ?? ""),
    });
    return Response.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_ADMIN_VOID_FAILED";
    return Response.json({ code }, { status: code === "GIFT_CARD_CODE_NOT_VOIDABLE" ? 409 : 400 });
  }
}
