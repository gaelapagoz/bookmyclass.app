"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CategoryTabs } from "./CategoryTabs";
import { ServiceCard } from "./ServiceCard";

type Category = {
  name: string;
  slug: string;
};

type Service = {
  description: string;
  durationMinutes: number;
  id: string;
  imageUrl: string | null;
  pricingMode: "SINGLE_ONLY" | "PLAN_ONLY" | "SINGLE_OR_PLAN";
  shortDescription: string;
  slug: string;
  title: string;
  weekdaySummary: string;
};

type ServicesApiResponse = {
  services: Service[];
};

type PublicCatalogueProps = {
  categories: Category[];
  initialCategorySlug: string | null;
  initialServices: Service[];
};

function ServicesSkeleton() {
  return (
    <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-xl border border-[#d8cec6] bg-white shadow-sm animate-pulse"
        >
          <div className="h-48 w-full bg-[#eadfd5]" />
          <div className="space-y-3 p-5">
            <div className="h-6 w-2/3 rounded bg-[#eadfd5]" />
            <div className="h-4 w-full rounded bg-[#f2ede7]" />
            <div className="h-4 w-5/6 rounded bg-[#f2ede7]" />
            <div className="h-4 w-3/4 rounded bg-[#f2ede7]" />
            <div className="h-9 w-24 rounded bg-[#eadfd5]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PublicCatalogue({
  categories,
  initialCategorySlug,
  initialServices,
}: PublicCatalogueProps) {
  const [selectedCategorySlug, setSelectedCategorySlug] = useState<string | null>(initialCategorySlug);
  const [servicesByCategory, setServicesByCategory] = useState<Record<string, Service[]>>(
    initialCategorySlug ? { [initialCategorySlug]: initialServices } : {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const services = useMemo(() => {
    if (!selectedCategorySlug) {
      return [];
    }

    return servicesByCategory[selectedCategorySlug] ?? [];
  }, [selectedCategorySlug, servicesByCategory]);

  const handleSelectCategory = async (slug: string) => {
    if (slug === selectedCategorySlug) {
      return;
    }

    setSelectedCategorySlug(slug);
    setErrorMessage(null);

    if (servicesByCategory[slug]) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/services?category=${encodeURIComponent(slug)}`);
      if (!response.ok) {
        throw new Error("Failed to load services.");
      }

      const data = (await response.json()) as ServicesApiResponse;
      setServicesByCategory((previous) => ({
        ...previous,
        [slug]: data.services,
      }));
    } catch {
      setErrorMessage("We could not load classes for this category right now.");
      setServicesByCategory((previous) => ({
        ...previous,
        [slug]: [],
      }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-14">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-wide text-[#6f2b2b] md:text-4xl">
          Book a Class
        </h1>
        <p className="mt-3 max-w-3xl text-base text-[#7f5a5a]">
          Browse our yoga, pilates, and functional classes. Choose a category to explore service
          options before selecting your preferred session in the next step.
        </p>
      </header>

      {categories.length === 0 ? (
        <p className="rounded-lg border border-[#d8cec6] bg-[#f4eee8] px-4 py-6 text-sm text-[#7f5a5a]">
          No public class categories are available yet.
        </p>
      ) : (
        <>
          <CategoryTabs
            categories={categories}
            selectedCategorySlug={selectedCategorySlug}
            onSelect={handleSelectCategory}
          />

          {isLoading ? <ServicesSkeleton /> : null}

          {errorMessage ? <p className="mt-6 text-sm text-[#7b2d2d]">{errorMessage}</p> : null}

          {!isLoading && services.length === 0 ? (
            <div className="mt-6 rounded-lg border border-[#d8cec6] bg-white px-4 py-6 text-sm text-[#7f5a5a]">
              <p>No active services are currently available for this category.</p>
              <p className="mt-2">Please select another category or return to the home page.</p>
              <Link
                href="/"
                className="mt-3 inline-block text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
              >
                Back to Home
              </Link>
            </div>
          ) : (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {services.map((service) => (
                <ServiceCard key={service.id} service={service} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
