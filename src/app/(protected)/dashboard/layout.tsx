import type { ReactNode } from "react";
import { DashboardNav } from "@/components/dashboard/DashboardNav";

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="grid items-start gap-5 lg:gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24">
          <DashboardNav />
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </section>
  );
}
