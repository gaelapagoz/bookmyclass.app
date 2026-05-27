import type { StaffPerformanceItem } from "@/lib/admin/admin-analytics-service";

type Props = {
  items: StaffPerformanceItem[];
  className?: string;
};

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

export default function AdminStaffPerformanceTable({ items, className }: Props) {
  return (
    <article className={`rounded-xl border border-[#d3dbe5] bg-white p-4 ${className ?? ""}`.trim()}>
      <h3 className="text-base font-semibold text-[#1f2735]">Staff Performance</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#4b5a72]">No staff sessions in the selected period.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-[#e2e8f0]">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f3f6fb] text-left text-xs uppercase tracking-wide text-[#5a6d86]">
              <tr>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Booked People</th>
                <th className="px-3 py-2">Classes Done</th>
                <th className="px-3 py-2">Occupancy</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.staffId} className="border-t border-[#e2e8f0] text-[#334155]">
                  <td className="px-3 py-2 font-medium">{item.staffName}</td>
                  <td className="px-3 py-2">{item.totalBookedPeople}</td>
                  <td className="px-3 py-2">{item.classesDone}</td>
                  <td className="px-3 py-2">{formatPercent(item.occupancyRatePercentage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}


