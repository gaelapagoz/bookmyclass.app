import Link from "next/link";

type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onChange: (nextPage: number) => string;
};

function getVisiblePages(page: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return Array.from({ length: 5 }, (_, index) => start + index);
}

export default function AdminPagination({ page, totalPages, onChange }: AdminPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = getVisiblePages(page, totalPages);
  const canGoPrevious = page > 1;
  const canGoNext = page < totalPages;

  return (
    <div className="flex items-center justify-between rounded-xl border border-[#d3dbe5] bg-white px-4 py-3 text-sm text-[#334155]">
      <p>
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        {canGoPrevious ? (
          <Link href={onChange(page - 1)} className="rounded-md border border-[#d3dbe5] px-3 py-1.5 hover:bg-[#f3f6fb]">
            Previous
          </Link>
        ) : (
          <span className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-[#94a3b8]" aria-disabled="true">
            Previous
          </span>
        )}

        {pages.map((pageNumber) =>
          pageNumber === page ? (
            <span key={pageNumber} className="rounded-md border border-[#1d3652] bg-[#1d3652] px-3 py-1.5 text-white">
              {pageNumber}
            </span>
          ) : (
            <Link
              key={pageNumber}
              href={onChange(pageNumber)}
              className="rounded-md border border-[#d3dbe5] px-3 py-1.5 hover:bg-[#f3f6fb]"
            >
              {pageNumber}
            </Link>
          ),
        )}

        {canGoNext ? (
          <Link href={onChange(page + 1)} className="rounded-md border border-[#d3dbe5] px-3 py-1.5 hover:bg-[#f3f6fb]">
            Next
          </Link>
        ) : (
          <span className="rounded-md border border-[#e2e8f0] px-3 py-1.5 text-[#94a3b8]" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </div>
  );
}

