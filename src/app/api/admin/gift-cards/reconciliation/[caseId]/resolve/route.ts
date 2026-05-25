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

const debugResolve =
  process.env.DEBUG_GIFT_CARD_RECONCILIATION_RESOLVE === "1";

function logResolveStage(stage: string, details?: Record<string, unknown>) {
  if (!debugResolve) return;
  console.info(`[gift-card-resolve-route] ${stage}`, details ?? {});
}

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
  const startedAt = Date.now();
  logResolveStage("route_entry");
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    logResolveStage("csrf_rejected", { elapsedMs: Date.now() - startedAt });
    return csrfRejection;
  }

  let session: Awaited<ReturnType<typeof requireAdminSession>>;
  try {
    session = await requireAdminSession({ throwOnFailure: true });
    logResolveStage("auth_ok", {
      userId: session.user.id,
      role: session.user.role,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNAUTHENTICATED";
    logResolveStage("auth_failed", { code, elapsedMs: Date.now() - startedAt });
    return Response.json(
      { code },
      { status: code === "FORBIDDEN" ? 403 : 401 },
    );
  }

  if (session.user.role !== Role.MASTER_ADMIN) {
    logResolveStage("master_admin_required", { elapsedMs: Date.now() - startedAt });
    return Response.json({ code: "GIFT_CARD_MASTER_ADMIN_REQUIRED" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
    logResolveStage("body_parsed", { elapsedMs: Date.now() - startedAt });
  } catch {
    logResolveStage("body_parse_failed", { elapsedMs: Date.now() - startedAt });
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  const parsed = resolveSchema.safeParse(payload);
  if (!parsed.success) {
    logResolveStage("body_validation_failed", { elapsedMs: Date.now() - startedAt });
    return Response.json({ code: "INVALID_REQUEST" }, { status: 400 });
  }

  let result: Awaited<ReturnType<typeof resolveGiftCardManualReviewCase>>;
  try {
    const { caseId } = await context.params;
    logResolveStage("service_call_start", {
      caseId,
      actorUserId: session.user.id,
      elapsedMs: Date.now() - startedAt,
    });
    result = await resolveGiftCardManualReviewCase({
      actor: { userId: session.user.id, role: session.user.role as Role },
      caseId,
      note: parsed.data.note,
    });
    logResolveStage("service_call_done", {
      caseId,
      resolved: result.resolved,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "GIFT_CARD_RECONCILIATION_RESOLVE_FAILED";
    logResolveStage("service_call_failed", { code, elapsedMs: Date.now() - startedAt });
    return Response.json(
      {
        code,
        metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
      },
      { status: resolveErrorStatus(code) },
    );
  }

  if (!result.resolved) {
    logResolveStage("consistency_failed_response", { elapsedMs: Date.now() - startedAt });
    return Response.json(
      {
        code: "GIFT_CARD_RECONCILIATION_CONSISTENCY_FAILED",
        verification: result.verification,
        metadata: { resolutionNoteDisclaimer: GIFT_CARD_RESOLUTION_NOTE_DISCLAIMER },
      },
      { status: 422 },
    );
  }

  logResolveStage("route_success_response", { elapsedMs: Date.now() - startedAt });
  return Response.json(result);
}
