import { z } from "zod";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { requestPasswordReset } from "@/lib/auth/password-service";
import { clearCapturedTestEmails, getCapturedTestEmails } from "@/lib/email/resend-delivery";

const payloadSchema = z.object({
  email: z.string().trim().email(),
  clearOutbox: z.boolean().optional(),
  requestReset: z.boolean().optional(),
});

function extractResetUrl(html: string): string | null {
  const hrefMatch = html.match(/href="([^"]*\/reset-password\?token=[^"]+)"/i);
  if (hrefMatch?.[1]) {
    return hrefMatch[1];
  }

  const textMatch = html.match(/(https?:\/\/[^\s"'<>]*\/reset-password\?token=[^\s"'<>]+)/i);
  return textMatch?.[1] ?? null;
}

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (parsed.data.clearOutbox) {
    clearCapturedTestEmails();
    return Response.json({ cleared: true }, { status: 200 });
  }

  if (parsed.data.requestReset) {
    await requestPasswordReset({
      email: parsed.data.email,
      appUrl: process.env.APP_URL,
    });
  }

  const targetEmail = parsed.data.email.toLowerCase();
  const candidates = getCapturedTestEmails()
    .filter((entry) => entry.context === "password-reset" && entry.to.some((recipient) => recipient === targetEmail))
    .toReversed();

  const latest = candidates.find((entry) => extractResetUrl(entry.html));
  const resetUrl = latest ? extractResetUrl(latest.html) : null;
  if (!latest || !resetUrl) {
    return Response.json({ error: "No reset email found." }, { status: 404 });
  }

  const parsedUrl = new URL(resetUrl);
  const token = parsedUrl.searchParams.get("token");
  if (!token) {
    return Response.json({ error: "Reset token missing from email." }, { status: 404 });
  }

  return Response.json(
    {
      email: targetEmail,
      token,
      resetUrl,
      createdAt: latest.createdAt,
    },
    { status: 200 },
  );
}
