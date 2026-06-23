import { auth } from "@/auth";
import { Role } from "@prisma/client";
import { getVerifiedCustomerState } from "@/lib/auth/verified-customer-state";
import { redeemLoyaltyReward, LoyaltyRedemptionServiceError } from "@/lib/loyalty/loyalty-redemption-service";
import { resolvePrimaryLoyaltyCurrencyCode } from "@/lib/loyalty/loyalty-program-service";
import { rejectIfNotSameOrigin } from "@/lib/security/same-origin";

export async function POST(request: Request) {
  const csrfRejection = rejectIfNotSameOrigin(request);
  if (csrfRejection) {
    return csrfRejection;
  }

  const session = await auth();
  const verifiedState = await getVerifiedCustomerState(session);

  if (verifiedState.kind === "signed-out") {
    return Response.json({ code: "AUTH_REQUIRED", message: "Sign in to redeem loyalty rewards." }, { status: 401 });
  }
  if (verifiedState.kind !== "verified" || verifiedState.session.user.role !== "CLIENT") {
    return Response.json(
      { code: "CLIENT_ACCESS_REQUIRED", message: "An active verified client account is required." },
      { status: 403 },
    );
  }

  let body: { rewardDefinitionId?: string } = {};
  try {
    body = (await request.json()) as { rewardDefinitionId?: string };
  } catch {
    return Response.json({ code: "INVALID_REQUEST", message: "Invalid loyalty redemption payload." }, { status: 400 });
  }

  if (!body.rewardDefinitionId?.trim()) {
    return Response.json({ code: "INVALID_REQUEST", message: "Reward selection is required." }, { status: 400 });
  }

  const currencyCode = await resolvePrimaryLoyaltyCurrencyCode();
  const clientId = verifiedState.session.user.id;

  try {
    const result = await redeemLoyaltyReward({
      actor: { type: "USER", userId: clientId, role: Role.CLIENT },
      clientId,
      currencyCode,
      rewardDefinitionId: body.rewardDefinitionId,
      idempotencyKey: `loyalty:reward-redeem:client:${clientId}:${body.rewardDefinitionId}:${new Date().toISOString().slice(0, 19)}`,
      metadata: { source: "dashboard-wallet" },
    });

    return Response.json({
      status: result.outcome === "replayed" ? "REPLAYED" : "REDEEMED",
      rewardRedemptionId: result.redemption.id,
    });
  } catch (error) {
    if (error instanceof LoyaltyRedemptionServiceError) {
      return Response.json(
        { code: error.code, message: error.message },
        { status: 422 },
      );
    }

    throw error;
  }
}
