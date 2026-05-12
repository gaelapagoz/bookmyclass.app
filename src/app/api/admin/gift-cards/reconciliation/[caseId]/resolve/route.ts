import { Role } from "@prisma/client";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
  resolveGiftCardManualReviewCase,
} from "@/lib/gift-cards/gift-card-admin-service";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

const resolveSchema = z.object({
  note: z.string().trim().min(1).max(2_000),
});

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

function resolveErrorStatus(code: string): number {
  if (code === "GIFT_CARD_RECONCILIATION_NOT_FOUND") {
    return 404;
  }
  if (
    code === "GIFT_CARD_RECONCILIATION_ALREADY_RESOLVED" ||
    code === "GIFT_CARD_MANUAL_REVIEW_REQUIRED"
  ) {
    return 409;
  }
  if (code === "GIFT_CARD_RESOLUTION_NOTE_REQUIRED") {
    return 400;
  }
  return 400;
}

export async function POST(request: Request, context: RouteContext) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return csrfRejection;
  }

  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession({ throwOnFailure: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHENTICATED";
    return Response.json(
      { code },
      { status: code === "FORBIDDEN" ? 403 : 401 },
    );
  }

  if (session.user.role !== Role.MASTER_ADMIN) {
    return Response.json({ code: "GIFT_CARD_MASTER_ADMIN_REQUIRED" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = resolveSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof resolveGiftCardManualReviewCase>>;
  try {
    const { caseId } = await context.params;
    result = await resolveGiftCardManualReviewCase({
      actor: { userId: session.user.id, role: session.user.role as Role },
      caseId,
      note: parsed.data.note,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_RECONCILIATION_RESOLVE_FAILED";
    return Response.json(
      {
        code,
        metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
      },
      { status: resolveErrorStatus(code) },
    );
  }

  if (!result.resolved) {
    return Response.json(
      {
        code: "GIFT_CARD_RECONCILIATION_CONSISTENCY_FAILED",
        verification: result.verification,
        metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
      },
      { status: 422 },
    );
  }

  return Response.json(result);
}
