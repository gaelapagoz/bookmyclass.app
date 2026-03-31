"use client";

import type { AdminPeriod, DashboardMetricKey, DashboardTrendPoint } from "@/lib/admin/admin-service";

type Props = {
  data: DashboardTrendPoint[];
  selectedMetric: DashboardMetricKey;
  period: AdminPeriod;
};

const METRIC_META: Record<DashboardMetricKey, { label: string; format: "number" | "currency" }> = {
  sessions: { label: "Sessions", format: "number" },
  sales: { label: "Total Sales", format: "currency" },
  orders: { label: "Total Orders", format: "number" },
  bookings: { label: "Total Bookings", format: "number" },
  cancellations: { label: "Total Cancellations", format: "number" },
};

function formatValue(value: number, format: "number" | "currency") {
  if (format === "currency") {
    return new Intl.NumberFormat("en-BE", {
      style: "currency",
      currency: "EUR",
    }).format(value / 100);
  }
  return new Intl.NumberFormat("en-BE").format(Math.round(value));
}

function pointValue(point: DashboardTrendPoint, metric: DashboardMetricKey): number {
  return point[metric];
}

function periodLabel(period: AdminPeriod) {
  if (period === "last7Days") {
    return "Last 7 days";
  }
  if (period === "last30Days") {
    return "Last 30 days";
  }
  return "Last 90 days";
}

export default function AdminDashboardTrendChart({ data, selectedMetric, period }: Props) {
  const metricMeta = METRIC_META[selectedMetric];
  const values = data.map((point) => pointValue(point, selectedMetric));
  const maxValue = Math.max(...values, 0);
  const chartHeight = 220;
  const chartWidth = 860;
  const paddingLeft = 42;
  const paddingRight = 16;
  const paddingTop = 14;
  const paddingBottom = 34;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;
  const denominator = maxValue === 0 ? 1 : maxValue;

  const points = data.map((point, index) => {
    const x = paddingLeft + (index / Math.max(data.length - 1, 1)) * plotWidth;
    const y = paddingTop + (1 - pointValue(point, selectedMetric) / denominator) * plotHeight;
    return { x, y };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const baselineY = paddingTop + plotHeight;
  const areaPath =
    points.length > 0
      ? `${path} L ${points[points.length - 1]?.x ?? paddingLeft} ${baselineY} L ${points[0]?.x ?? paddingLeft} ${baselineY} Z`
      : "";

  const xTickIndexes = [0, Math.floor((data.length - 1) / 2), data.length - 1].filter(
    (value, index, arr) => value >= 0 && arr.indexOf(value) === index,
  );

  const yTicks = [0, 0.5, 1].map((ratio) => {
    const value = Math.round(maxValue * (1 - ratio));
    const y = paddingTop + ratio * plotHeight;
    return { value, y };
  });

  return (
    <article className="rounded-xl border border-[#d3dbe5] bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-[#1f2735]">{metricMeta.label} Trend</h3>
        <span className="text-xs text-[#5a6d86]">{periodLabel(period)}</span>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-[#4b5a72]">No trend data available.</p>
      ) : (
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-[220px] w-full min-w-[720px]" role="img" aria-label={`${metricMeta.label} daily trend`}>
            {yTicks.map((tick) => (
              <g key={`y-${tick.y}`}>
                <line x1={paddingLeft} y1={tick.y} x2={chartWidth - paddingRight} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={6} y={tick.y + 4} fontSize="10" fill="#5a6d86">
                  {formatValue(tick.value, metricMeta.format)}
                </text>
              </g>
            ))}

            {areaPath ? <path d={areaPath} fill="rgba(59, 130, 246, 0.20)" stroke="none" /> : null}
            <path d={path} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
            {points.map((point, index) => (
              <circle key={`p-${index}`} cx={point.x} cy={point.y} r="2.5" fill="#3b82f6">
                <title>
                  {new Intl.DateTimeFormat("en-BE", { dateStyle: "medium" }).format(new Date(data[index]?.date ?? ""))}
                  {" - "}
                  {formatValue(values[index] ?? 0, metricMeta.format)}
                </title>
              </circle>
            ))}

            {xTickIndexes.map((index) => {
              const x = paddingLeft + (index / Math.max(data.length - 1, 1)) * plotWidth;
              const label = new Intl.DateTimeFormat("en-BE", { month: "short", day: "numeric" }).format(new Date(data[index]?.date ?? ""));
              return (
                <text key={`x-${index}`} x={x} y={chartHeight - 10} textAnchor="middle" fontSize="10" fill="#5a6d86">
                  {label}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </article>
  );
}
