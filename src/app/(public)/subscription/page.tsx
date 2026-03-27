import { SubscriptionProductsClient } from "@/components/subscription/SubscriptionPlansClient";
import { getActiveSubscriptionCatalogProducts } from "@/lib/subscription/subscription-products";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const products = await getActiveSubscriptionCatalogProducts();

  return <SubscriptionProductsClient initialProducts={products} />;
}
