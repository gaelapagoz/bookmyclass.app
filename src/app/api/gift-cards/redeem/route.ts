import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import {
  redeemGiftCardCode,
  GiftCardCodeRedemptionError,
} from "@/lib/gift-cards/gift-card-code-service";

const bodySchema = z.object({
  code: z.string().min(1).max(64),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await redeemGiftCardCode({
      redeemerUserId: session.user.id,
      redeemerClientId: session.user.id,
      plaintextCode: parsed.data.code,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof GiftCardCodeRedemptionError) {
      if (error.errorCode === "RATE_LIMITED") {
        return NextResponse.json({ error: error.message, code: error.errorCode }, { status: 429 });
      }
      if (error.errorCode === "WALLET_ERROR") {
        return NextResponse.json({ error: error.message, code: error.errorCode }, { status: 503 });
      }
      return NextResponse.json({ error: error.message, code: error.errorCode }, { status: 422 });
    }
    console.error("[api/gift-cards/redeem] unexpected error", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "Unexpected error. Please try again." }, { status: 500 });
  }
}
