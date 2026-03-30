import type { TopClassSessionItem } from "@/lib/admin/admin-service";

type Props = {
  items: TopClassSessionItem[];
  className?: string;
};

export default function AdminTopClassSessionsCard({ items, className }: Props) {
  return (
    <article className={`rounded-xl border border-[#d3dbe5] bg-white p-4 ${className ?? ""}`.trim()}>
      <h3 className="text-base font-semibold text-[#1f2735]">Top Class Sessions</h3>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#4b5a72]">No bookings in the selected period.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.classTemplateId} className="rounded-md border border-[#e2e8f0] px-3 py-2">
              <p className="text-sm font-medium text-[#1f2735]">{item.classTitle}</p>
              <p className="text-xs text-[#5a6d86]">
                {item.teacherName ? `Teacher: ${item.teacherName}` : "Teacher: Unassigned"}
              </p>
              <p className="text-xs text-[#5a6d86]">
                {item.bookedCount} booked - {item.sessionCount} sessions - avg cap {item.averageCapacity}
              </p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}




