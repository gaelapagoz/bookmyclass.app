import type { AdminMetricCard as AdminMetricCardData } from "@/lib/admin/admin-service";

type AdminMetricCardProps = AdminMetricCardData & {
  isSelected?: boolean;
  onSelect?: () => void;
};

const CURRENCY_CODE = "EUR";

function formatMetricValue(value: number, format: AdminMetricCardData["format"]) {
  if (format === "currency") {
    return new Intl.NumberFormat("en-BE", {
      style: "currency",
      currency: CURRENCY_CODE,
    }).format(value / 100);
  }

  return new Intl.NumberFormat("en-BE").format(value);
}

function getDeltaLabel(card: AdminMetricCardData) {
  if (card.deltaPercentage === null) {
    return "+NEW";
  }

  if (card.deltaPercentage === 0) {
    return "0.0%";
  }

  const absolute = Math.abs(card.deltaPercentage).toFixed(1);
  return `${card.deltaPercentage > 0 ? "+" : "-"}${absolute}%`;
}

function getDeltaClassName(direction: AdminMetricCardData["trendDirection"]) {
  if (direction === "up") {
    return "border-[#d4f4dd] bg-[#edf9f1] text-[#166534]";
  }

  if (direction === "down") {
    return "border-[#f5d2d2] bg-[#fdf2f2] text-[#9f1c1c]";
  }

  return "border-[#d3dbe5] bg-[#f3f6fb] text-[#334155]";
}

function AdminMetricCardContent(props: AdminMetricCardProps) {
  return (
    <>
      <p className="text-xs uppercase tracking-wide text-[#5a6d86]">{props.label}</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="text-2xl font-semibold text-[#1f2735]">{formatMetricValue(props.total, props.format)}</p>
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${getDeltaClassName(props.trendDirection)}`}
        >
          {getDeltaLabel(props)}
        </span>
      </div>
      <p className="mt-3 text-xs text-[#5a6d86]">
        {formatMetricValue(props.currentDailyValue, props.format)} today - {" "}
        {formatMetricValue(props.previousDailyValue, props.format)} yesterday
      </p>
    </>
  );
}

export default function AdminMetricCard(props: AdminMetricCardProps) {
  if (!props.onSelect) {
    return (
      <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
        <AdminMetricCardContent {...props} />
      </article>
    );
  }

  return (
    <button
      type="button"
      onClick={props.onSelect}
      className="relative rounded-xl border border-[#d3dbe5] bg-white p-4 text-left transition hover:border-[#9fb4cd]"
    >
      <AdminMetricCardContent {...props} />
      {props.isSelected ? <span className="absolute inset-x-0 bottom-0 h-1 rounded-b-xl bg-[#2563eb]" aria-hidden="true" /> : null}
    </button>
  );
}

