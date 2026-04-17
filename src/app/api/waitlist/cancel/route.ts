import { z } from "zod";
import { auth } from "@/auth";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";
import { cancelSessionWaitlistEntry, WaitlistServiceError } from "@/lib/public-booking/waitlist-service";

const cancelWaitlistSchema = z.object({
  waitlistEntryId: z.string().min(1).max(120),
});

function toStatusCode(code: WaitlistServiceError["code"]): number {
  switch (code) {
    case "WAITLIST_ENTRY_NOT_FOUND":
      return 404;
    case "WAITLIST_ENTRY_NOT_OWNED":
      return 403;
    case "WAITLIST_ENTRY_NOT_ACTIVE":
      return 400;
    default:
      return 400;
  }
}

export async function POST(request: Request) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return csrfRejection;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = cancelWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid waitlist cancellation payload.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const session = await auth();
  const authenticatedUserId = session?.user?.id ?? null;
  if (!authenticatedUserId) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    await cancelSessionWaitlistEntry({
      clientId: authenticatedUserId,
      waitlistEntryId: parsed.data.waitlistEntryId,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (error instanceof WaitlistServiceError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatusCode(error.code) });
    }

    return Response.json(
      { error: "Unexpected error while cancelling waitlist entry.", code: "WAITLIST_CANCEL_FAILED" },
      { status: 500 },
    );
  }
}

