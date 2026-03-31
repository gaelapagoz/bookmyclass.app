import { NextResponse } from "next/server";

import { unsubscribeMarketingByToken } from "@/lib/marketing/marketing-delivery";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (token?.trim()) {
      await unsubscribeMarketingByToken(token.trim());
    }
  } catch (error) {
    console.error("[marketing-tracking] unsubscribe", error);
  }

  return NextResponse.json(
    {
      ok: true,
      message: "You have been unsubscribed from marketing emails.",
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    },
  );
}
