import { auth } from "@/auth";
import { SubscriptionProductsClient } from "@/components/subscription/SubscriptionPlansClient";
import { hasActiveSubscriptionForCartConstraint } from "@/lib/cart/cart-service";
import { getActiveSubscriptionCatalogProducts } from "@/lib/subscription/subscription-products";

export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [products, hasActiveSubscription] = await Promise.all([
    getActiveSubscriptionCatalogProducts(),
    userId ? hasActiveSubscriptionForCartConstraint(userId) : Promise.resolve(false),
  ]);

  return (
    <SubscriptionProductsClient
      initialProducts={products}
      hasActiveSubscription={hasActiveSubscription}
    />
  );
}
