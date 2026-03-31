import { NextResponse } from "next/server";

import { recordMarketingOpenByToken } from "@/lib/marketing/marketing-delivery";

export const dynamic = "force-dynamic";

const ONE_PIXEL_GIF = Buffer.from("R0lGODlhAQABAPAAAAAAAAAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (token?.trim()) {
      await recordMarketingOpenByToken(token.trim());
    }
  } catch (error) {
    console.error("[marketing-tracking] open", error);
  }

  return new NextResponse(ONE_PIXEL_GIF, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
