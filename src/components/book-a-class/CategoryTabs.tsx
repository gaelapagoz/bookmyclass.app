"use client";

type Category = {
  name: string;
  slug: string;
};

type CategoryTabsProps = {
  categories: Category[];
  onSelect: (slug: string) => void;
  selectedCategorySlug: string | null;
};

export function CategoryTabs({ categories, onSelect, selectedCategorySlug }: CategoryTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div
        className="inline-flex min-w-full gap-2 rounded-lg border border-[#d8cec6] bg-[#f4eee8] p-2"
        role="tablist"
        aria-label="Class categories"
      >
        {categories.map((category) => {
          const isActive = category.slug === selectedCategorySlug;

          return (
            <button
              key={category.slug}
              type="button"
              onClick={() => onSelect(category.slug)}
              role="tab"
              aria-selected={isActive}
              aria-label={`Show ${category.name} classes`}
              tabIndex={isActive ? 0 : -1}
              className={`whitespace-nowrap rounded-md px-4 py-2 text-sm transition ${
                isActive
                  ? "bg-[#7b2d2d] text-[#f4eee8]"
                  : "bg-transparent text-[#7b2d2d] hover:bg-[#eadfd5]"
              }`}
            >
              {category.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
