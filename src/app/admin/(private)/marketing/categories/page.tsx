import MarketingCategoryTable from "@/components/admin/marketing/MarketingCategoryTable";
import { listMarketingCategories } from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminMarketingCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const categories = await listMarketingCategories();

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Marketing Categories</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Organize campaigns by one category per campaign.</p>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <MarketingCategoryTable
        rows={categories.map((category) => ({
          id: category.id,
          name: category.name,
          slug: category.slug,
          isActive: category.isActive,
          usageCount: category.usageCount,
        }))}
      />
    </section>
  );
}

