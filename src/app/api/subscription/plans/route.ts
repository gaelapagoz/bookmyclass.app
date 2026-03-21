import { getActiveSubscriptionCatalogProducts } from "@/lib/subscription/subscription-products";

export async function GET() {
  const products = await getActiveSubscriptionCatalogProducts();

  return Response.json({ products }, { status: 200 });
}
