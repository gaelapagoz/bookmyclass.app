import { StorePageClient } from "@/components/store/StorePageClient";
import { listStoreCatalogReadModels } from "@/lib/store/store-catalog";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  const products = await listStoreCatalogReadModels();

  return <StorePageClient products={products} />;
}
