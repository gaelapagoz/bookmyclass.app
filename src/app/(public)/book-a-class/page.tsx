import { PublicCatalogue } from "../../../components/book-a-class/PublicCatalogue";
import {
  getPublicCategories,
  getPublicServicesByCategorySlug,
} from "../../../lib/public-catalogue/catalogue-service";

export default async function BookAClassPage() {
  const categories = await getPublicCategories();
  const initialCategorySlug = categories[0]?.slug ?? null;
  const initialServices = initialCategorySlug
    ? await getPublicServicesByCategorySlug(initialCategorySlug)
    : [];

  return (
    <PublicCatalogue
      categories={categories}
      initialCategorySlug={initialCategorySlug}
      initialServices={initialServices}
    />
  );
}
