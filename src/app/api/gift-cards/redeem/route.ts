import { NextRequest, NextResponse } from "next/server";
import { Role, UserActivationStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import {
  redeemGiftCardCode,
  GiftCardCodeRedemptionError,
} from "@/lib/gift-cards/gift-card-code-service";
import { prisma } from "@/lib/db";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

const bodySchema = z.object({
  code: z.string().min(1).max(64),
});

export async function POST(request: NextRequest): Promise<Response> {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return csrfRejection;
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      activationStatus: true,
      emailVerified: true,
      isActive: true,
    },
  });

  if (
    !user ||
    user.role !== Role.CLIENT ||
    user.activationStatus !== UserActivationStatus.ACTIVE ||
    !user.emailVerified ||
    !user.isActive
  ) {
    return NextResponse.json(
      { error: "Your account must be active and email-verified before redeeming a gift card.", code: "EMAIL_VERIFICATION_REQUIRED" },
      { status: 403 },
    );
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
