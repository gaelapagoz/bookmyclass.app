import Link from "next/link";
import type { ReactNode } from "react";

type CampaignFlowLayoutProps = {
  title: string;
  description: string;
  controls: ReactNode;
  preview: ReactNode;
  topBackHref?: string;
  topBackLabel?: string;
};

export default function CampaignFlowLayout({
  title,
  description,
  controls,
  preview,
  topBackHref,
  topBackLabel = "Back to campaigns",
}: CampaignFlowLayoutProps) {
  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1f2735]">{title}</h1>
          <p className="mt-1 text-sm text-[#4b5a72]">{description}</p>
        </div>
        {topBackHref ? (
          <Link href={topBackHref} className="text-sm text-[#2a4f78] underline underline-offset-4">
            {topBackLabel}
          </Link>
        ) : null}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">{controls}</div>
        <div className="min-h-[620px] lg:col-span-2">{preview}</div>
      </div>
    </section>
  );
}
