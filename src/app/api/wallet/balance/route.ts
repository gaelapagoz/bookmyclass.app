import { auth } from "@/auth";
import { getGiftCardWalletBalance } from "@/lib/gift-cards/gift-card-wallet-service";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ balance: null }, { status: 401 });
  }

  const balance = await getGiftCardWalletBalance(session.user.id);
  return Response.json({ balance: balance ?? null });
}
