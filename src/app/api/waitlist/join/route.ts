import { z } from "zod";
import { auth } from "@/auth";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";
import { joinSessionWaitlist, WaitlistServiceError } from "@/lib/public-booking/waitlist-service";

const joinWaitlistSchema = z.object({
  sessionId: z.string().min(1).max(120),
});

function toStatusCode(code: WaitlistServiceError["code"]): number {
  switch (code) {
    case "SESSION_NOT_FOUND":
      return 404;
    case "WAITLIST_ENTRY_NOT_FOUND":
      return 404;
    case "WAITLIST_ENTRY_NOT_OWNED":
      return 403;
    case "SESSION_NOT_BOOKABLE":
    case "WAITLIST_NOT_SUPPORTED":
    case "SESSION_NOT_FULL":
    case "WAITLIST_FULL":
    case "ALREADY_BOOKED":
    case "ALREADY_WAITLISTED":
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

  const parsed = joinWaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid waitlist join payload.",
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
    const result = await joinSessionWaitlist({
      clientId: authenticatedUserId,
      studioSessionId: parsed.data.sessionId,
    });

    return Response.json({ waitlist: result }, { status: 201 });
  } catch (error) {
    if (error instanceof WaitlistServiceError) {
      return Response.json({ error: error.message, code: error.code }, { status: toStatusCode(error.code) });
    }

    return Response.json(
      { error: "Unexpected error while joining waitlist.", code: "WAITLIST_JOIN_FAILED" },
      { status: 500 },
    );
  }
}

