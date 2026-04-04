import MarketingSegmentTable from "@/components/admin/marketing/MarketingSegmentTable";
import { listMarketingSegments } from "@/lib/marketing/marketing-service";

type SearchParams = Promise<{ error?: string }>;

export default async function AdminMarketingSegmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const { error } = await searchParams;
  const segments = await listMarketingSegments();

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-[#1f2735]">Marketing Segments</h1>
        <p className="mt-1 text-sm text-[#4b5a72]">Manage reusable segments for client marketing grouping.</p>
      </header>

      {error ? <p className="text-sm text-[#7b2d2d]">{error}</p> : null}

      <MarketingSegmentTable
        rows={segments.map((segment) => ({
          id: segment.id,
          name: segment.name,
          slug: segment.slug,
          isActive: segment.isActive,
          usageCount: segment.usageCount,
        }))}
      />
    </section>
  );
}
