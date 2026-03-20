"use client";

import Link from "next/link";
import { useState } from "react";

type Service = {
  description: string;
  durationMinutes: number;
  id: string;
  imageUrl: string | null;
  pricingMode: "SINGLE_ONLY" | "PLAN_ONLY" | "SINGLE_OR_PLAN";
  shortDescription: string;
  slug: string;
  title: string;
  weekdaySummary: string;
};

type ServiceCardProps = {
  service: Service;
};

const pricingModeLabel: Record<Service["pricingMode"], string> = {
  SINGLE_ONLY: "Single booking",
  PLAN_ONLY: "Plan required",
  SINGLE_OR_PLAN: "Single or plan",
};

export function ServiceCard({ service }: ServiceCardProps) {
  const [showDescription, setShowDescription] = useState(false);
  const descriptionId = `service-description-${service.id}`;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-[#d8cec6] bg-white shadow-sm">
      <div className="relative h-48 w-full bg-[#eadfd5]">
        {service.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.imageUrl} alt={service.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-sm text-[#7f5a5a]">
            Image coming soon
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-xl font-semibold text-[#6f2b2b]">{service.title}</h2>
        <p
          className="mt-2 min-h-[3.75rem] text-sm leading-5 text-[#7f5a5a]"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 3,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {service.shortDescription}
        </p>

        <dl className="mt-4 space-y-1 text-sm text-[#5f4040]">
          <div className="flex gap-2">
            <dt className="font-medium">Days:</dt>
            <dd>{service.weekdaySummary}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Duration:</dt>
            <dd>{service.durationMinutes} min</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">Pricing:</dt>
            <dd>{pricingModeLabel[service.pricingMode]}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="mt-4 w-fit text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
          onClick={() => setShowDescription((previous) => !previous)}
          aria-expanded={showDescription}
          aria-controls={descriptionId}
          aria-label={`${showDescription ? "Hide" : "Show"} full description for ${service.title}`}
        >
          Description
        </button>
        <div id={descriptionId} className="min-h-[2.5rem]">
          {showDescription ? <p className="mt-2 text-sm text-[#5f4040]">{service.description}</p> : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-6">
          <Link
            href={`/book-a-class/${service.slug}`}
            className="rounded-md bg-[#7b2d2d] px-4 py-2 text-sm text-[#f4eee8] transition hover:opacity-90"
            aria-label={`Book ${service.title}`}
          >
            Book Now
          </Link>
          <Link
            href={`/book-a-class?service=${service.slug}#plans`}
            className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
            aria-label={`Explore plans for ${service.title}`}
          >
            Explore Plans
          </Link>
        </div>
      </div>
    </article>
  );
}
