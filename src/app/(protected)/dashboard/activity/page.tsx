import Link from "next/link";
import { requireAuth } from "@/lib/auth/require-auth";
import { getClientActivityPage } from "@/lib/dashboard/dashboard-service";

type SearchParams = Promise<{ filter?: string; page?: string; pageSize?: string }>;

export default async function DashboardActivityPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireAuth();
  const { filter, page, pageSize } = await searchParams;

  const data = await getClientActivityPage(session.user.id, { filter, page, pageSize });

  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-[#1f2735]">Activity</h1>
        <Link href="/dashboard" className="text-sm text-[#2a4f78] underline underline-offset-4">
          Back to dashboard
        </Link>
      </header>

      <div className="flex gap-2 text-sm">
        {(["all", "bookings", "orders"] as const).map((f) => (
          <Link
            key={f}
            href={`/dashboard/activity?filter=${f}&page=1`}
            className={`rounded-md px-3 py-1 ${
              data.filter === f
                ? "bg-[#1d3652] text-white"
                : "border border-[#d3dbe5] text-[#334155] hover:bg-[#f1f5f9]"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Link>
        ))}
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-[#64748b]">No activity found.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between rounded-lg border border-[#d3dbe5] bg-white px-4 py-3 text-sm"
            >
              <div>
                <span className="mr-2 rounded bg-[#f1f5f9] px-1.5 py-0.5 text-xs text-[#64748b]">
                  {item.type}
                </span>
                <span className="font-medium text-[#1f2735]">{item.label}</span>
                {item.detail ? (
                  <span className="ml-2 text-[#64748b]">{item.detail}</span>
                ) : null}
              </div>
              <div className="ml-4 shrink-0 text-right">
                <span className="block text-xs text-[#64748b]">{item.status}</span>
                <span className="block text-xs text-[#94a3b8]">
                  {new Intl.DateTimeFormat("en-BE", { dateStyle: "medium", timeStyle: "short" }).format(
                    new Date(item.timestamp),
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-sm text-[#64748b]">
        <span>
          {data.total > 0
            ? `Showing ${Math.min((data.page - 1) * data.pageSize + 1, data.total)}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}`
            : ""}
        </span>
        <div className="flex gap-2">
          {data.page > 1 && (
            <Link
              href={`/dashboard/activity?filter=${data.filter}&page=${data.page - 1}&pageSize=${data.pageSize}`}
              className="rounded border border-[#d3dbe5] px-3 py-1 hover:bg-[#f1f5f9]"
            >
              Previous
            </Link>
          )}
          {data.page * data.pageSize < data.total && (
            <Link
              href={`/dashboard/activity?filter=${data.filter}&page=${data.page + 1}&pageSize=${data.pageSize}`}
              className="rounded border border-[#d3dbe5] px-3 py-1 hover:bg-[#f1f5f9]"
            >
              Next
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
