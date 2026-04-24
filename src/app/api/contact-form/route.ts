import * as Sentry from "@sentry/nextjs";
import { ContactFormServiceError, submitHomesiteContactForm } from "@/lib/contact-form/contact-form-service";
import { getTrustedClientIpFromHeaders } from "@/lib/security/rate-limit";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

const GENERIC_MESSAGE = "Thanks. If your request is valid, we will contact you soon.";

export async function POST(request: Request) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 400 });
  }

  try {
    const allowForwardedForFallback =
      process.env.NODE_ENV !== "production" || process.env.TRUST_X_FORWARDED_FOR === "1";

    await submitHomesiteContactForm(payload, {
      ipAddress: getTrustedClientIpFromHeaders(request.headers, {
        allowForwardedFor: allowForwardedForFallback,
      }),
    });
    return Response.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
  } catch (error) {
    if (error instanceof ContactFormServiceError) {
      if (error.code === "INVALID_PAYLOAD") {
        return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 400 });
      }

      if (error.code === "HONEYPOT_REJECTED" || error.code === "RATE_LIMITED") {
        return Response.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
      }

      Sentry.captureException(new Error(`[homesite-contact-form] ${error.code}`), {
        level: "error",
        tags: {
          area: "homesite-contact-form",
          error_code: error.code,
        },
      });
      return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 500 });
    }

    Sentry.captureException(error, {
      level: "error",
      tags: {
        area: "homesite-contact-form",
        error_code: "UNEXPECTED",
      },
    });
    return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 500 });
  }
}
