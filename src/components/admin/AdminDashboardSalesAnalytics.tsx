"use client";

import { useMemo, useState } from "react";

import AdminDashboardTrendChart from "@/components/admin/AdminDashboardTrendChart";
import AdminMetricCard from "@/components/admin/AdminMetricCard";
import type {
  AdminMetricCard as AdminMetricCardData,
  AdminPeriod,
  DashboardMetricKey,
  DashboardTrendPoint,
} from "@/lib/admin/admin-service";

type Props = {
  cards: AdminMetricCardData[];
  trend: DashboardTrendPoint[];
  period: AdminPeriod;
};

const CARD_TO_METRIC: Record<AdminMetricCardData["key"], DashboardMetricKey> = {
  siteSessions: "sessions",
  totalSales: "sales",
  totalOrders: "orders",
  bookings: "bookings",
  cancellations: "cancellations",
};

export default function AdminDashboardSalesAnalytics({ cards, trend, period }: Props) {
  const [selectedMetric, setSelectedMetric] = useState<DashboardMetricKey>("sales");
  const selectedFromCards = useMemo(
    () =>
      new Set(
        cards
          .map((card) => CARD_TO_METRIC[card.key])
          .filter((metric): metric is DashboardMetricKey => Boolean(metric)),
      ),
    [cards],
  );

  const fallbackMetric = selectedFromCards.has(selectedMetric)
    ? selectedMetric
    : (cards[0] ? CARD_TO_METRIC[cards[0].key] : "sales");

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const { key, ...cardProps } = card;
          const metricKey = CARD_TO_METRIC[card.key];
          return (
            <AdminMetricCard
              key={key}
              {...cardProps}
              isSelected={fallbackMetric === metricKey}
              onSelect={() => setSelectedMetric(metricKey)}
            />
          );
        })}
      </div>
      <AdminDashboardTrendChart data={trend} selectedMetric={fallbackMetric} period={period} />
    </div>
  );
}
