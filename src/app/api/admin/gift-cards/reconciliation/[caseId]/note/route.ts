import { Role } from "@prisma/client";
import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/require-auth";
import {
  GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER,
  addGiftCardReconciliationNote,
} from "@/lib/gift-cards/gift-card-admin-service";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

const noteSchema = z.object({
  note: z.string().trim().min(1).max(2_000),
});

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

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

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = noteSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  let updated: Awaited<ReturnType<typeof addGiftCardReconciliationNote>>;
  try {
    const { caseId } = await context.params;
    updated = await addGiftCardReconciliationNote({
      actor: { userId: session.user.id, role: session.user.role as Role },
      caseId,
      note: parsed.data.note,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_RECONCILIATION_NOTE_FAILED";
    return Response.json(
      {
        code,
        metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
      },
      { status: code === "GIFT_CARD_RECONCILIATION_NOT_FOUND" ? 404 : 400 },
    );
  }

  return Response.json({
    case: updated,
    metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
  });
}
