import { NextRequest, NextResponse } from "next/server";

const RESEND_API_URL = "https://api.resend.com/emails";

type TestEmailPayload = {
  to?: string;
};

function getRecipient(input: { bodyTo?: string; queryTo?: string }): string | null {
  const candidate = input.bodyTo?.trim() || input.queryTo?.trim() || process.env.TEST_EMAIL_TO?.trim();
  return candidate ? candidate : null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendTestEmail(request: NextRequest, body: TestEmailPayload): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "This route is for local development only." },
      { status: 403 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  const to = getRecipient({
    bodyTo: body.to,
    queryTo: request.nextUrl.searchParams.get("to") ?? undefined,
  });

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing RESEND_API_KEY." }, { status: 500 });
  }
  if (!from) {
    return NextResponse.json({ ok: false, error: "Missing EMAIL_FROM." }, { status: 500 });
  }
  if (!to || !isValidEmail(to)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Provide a valid developer inbox via body.to, ?to=, or TEST_EMAIL_TO.",
      },
      { status: 400 },
    );
  }

  const subject = "[Local Test] Book My Class - Resend Validation";
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;">
      <h2>Resend test email</h2>
      <p>This confirms your local API route can send through Resend.</p>
      <p><strong>Environment:</strong> ${process.env.NODE_ENV ?? "unknown"}</p>
      <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
    </div>
  `;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
      cache: "no-store",
    });

    const responseBody = await response.json().catch(async () => ({ raw: await response.text() }));

    if (!response.ok) {
      console.error("[api/test-email] resend send failed", {
        status: response.status,
        statusText: response.statusText,
        to,
        from,
        responseBody,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "Resend request failed.",
          status: response.status,
          details: responseBody,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      provider: "resend",
      to,
      from,
      result: responseBody,
    });
  } catch (error) {
    console.error("[api/test-email] unexpected error", {
      to,
      from,
      error,
    });

    return NextResponse.json(
      { ok: false, error: "Unexpected error while sending test email." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return sendTestEmail(request, {});
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as TestEmailPayload;
  return sendTestEmail(request, body);
}
