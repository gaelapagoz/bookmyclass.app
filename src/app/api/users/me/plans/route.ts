import { auth } from "../../../../../auth";
import { getMyActivePlans } from "../../../../../lib/public-booking/booking-payment-options-service";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }

  const plans = await getMyActivePlans(userId);
  return Response.json({ plans });
}
