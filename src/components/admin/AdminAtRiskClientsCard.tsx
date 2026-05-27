import type { AtRiskClientItem } from "@/lib/admin/admin-analytics-service";

type Props = {
  items: AtRiskClientItem[];
  className?: string;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-BE", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export default function AdminAtRiskClientsCard({ items, className }: Props) {
  return (
    <article className={`rounded-xl border border-[#d3dbe5] bg-white p-4 ${className ?? ""}`.trim()}>
      <h3 className="text-base font-semibold text-[#1f2735]">At-Risk Clients</h3>
      <p className="mt-1 text-xs text-[#5a6d86]">
        Had historical bookings but no valid booking in the selected period.
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#4b5a72]">No at-risk clients right now.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.clientId} className="flex items-center justify-between rounded-md border border-[#e2e8f0] px-3 py-2">
              <p className="text-sm font-medium text-[#1f2735]">{item.clientName}</p>
              <p className="text-xs text-[#5a6d86]">Last booking {formatDate(item.lastBookingAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}


