import { auth } from "@/auth";
import { getVerifiedCustomerState } from "@/lib/auth/verified-customer-state";
import { getLoyaltyCreditBalance, listActiveLoyaltyRewards } from "@/lib/loyalty/loyalty-redemption-service";
import { resolvePrimaryLoyaltyCurrencyCode } from "@/lib/loyalty/loyalty-program-service";
import { getClientLoyaltySummary } from "@/lib/loyalty/loyalty-read-service";

export async function GET() {
  const session = await auth();
  const verifiedState = await getVerifiedCustomerState(session);

  if (verifiedState.kind === "signed-out") {
    return Response.json({ code: "AUTH_REQUIRED", loyalty: null }, { status: 401 });
  }
  if (verifiedState.kind !== "verified" || verifiedState.session.user.role !== "CLIENT") {
    return Response.json(
      { code: "CLIENT_ACCESS_REQUIRED", loyalty: null, message: "An active verified client account is required." },
      { status: 403 },
    );
  }

  const clientId = verifiedState.session.user.id;

  const currencyCode = await resolvePrimaryLoyaltyCurrencyCode();
  const [summary, loyaltyCredit, rewards] = await Promise.all([
    getClientLoyaltySummary({
      actor: { type: "CLIENT", userId: clientId },
      clientId,
      currencyCode,
    }),
    getLoyaltyCreditBalance({
      clientId,
      currencyCode,
    }),
    listActiveLoyaltyRewards({ currencyCode }),
  ]);

  return Response.json({
    loyalty: {
      currencyCode,
      summary,
      loyaltyCredit,
      rewards,
    },
  });
}
