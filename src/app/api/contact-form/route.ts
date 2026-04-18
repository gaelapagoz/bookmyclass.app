import { ContactFormServiceError, submitHomesiteContactForm } from "@/lib/contact-form/contact-form-service";
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
    await submitHomesiteContactForm(payload);
    return Response.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
  } catch (error) {
    if (error instanceof ContactFormServiceError) {
      if (error.code === "INVALID_PAYLOAD") {
        return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 400 });
      }

      if (error.code === "HONEYPOT_REJECTED") {
        return Response.json({ ok: true, message: GENERIC_MESSAGE }, { status: 200 });
      }
    }

    return Response.json({ ok: false, message: GENERIC_MESSAGE }, { status: 500 });
  }
}
