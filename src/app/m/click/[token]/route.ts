import { NextResponse } from "next/server";

import { recordMarketingClickByToken } from "@/lib/marketing/marketing-delivery";

export const dynamic = "force-dynamic";

function sanitizeRedirectUrl(url: string | null): string {
  if (!url) {
    return "/";
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "/";
    }
    return parsed.toString();
  } catch {
    return "/";
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  try {
    const url = new URL(request.url);
    const recipientToken = url.searchParams.get("r");
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor?.split(",")[0]?.trim() || null;
    const userAgent = request.headers.get("user-agent");

    const result = await recordMarketingClickByToken({
      linkToken: token,
      recipientToken,
      ip,
      userAgent,
    });

    return NextResponse.redirect(sanitizeRedirectUrl(result.redirectUrl), { status: 307 });
  } catch (error) {
    console.error("[marketing-tracking] click", error);
    return NextResponse.redirect("/", { status: 307 });
  }
}
