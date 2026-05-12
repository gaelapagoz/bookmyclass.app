import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { getCapturedTestEmails, clearCapturedTestEmails } from "@/lib/email/resend-delivery";

export async function GET(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  return Response.json({ emails: getCapturedTestEmails() }, { status: 200 });
}

export async function DELETE(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  clearCapturedTestEmails();
  return Response.json({ cleared: true }, { status: 200 });
}
