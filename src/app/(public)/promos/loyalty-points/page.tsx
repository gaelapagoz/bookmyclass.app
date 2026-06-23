import Image from "next/image";
import Link from "next/link";
import { loyaltyHowItWorksPageContent } from "@/lib/public-content/loyalty-content";

export default function LoyaltyPointsPromoPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="relative overflow-hidden rounded-[2rem] border border-[#eadfd7] bg-[#f8f3ed] shadow-[0_18px_45px_rgba(98,52,41,0.12)]">
        <div className="relative aspect-[16/9] min-h-[260px] w-full">
          <Image
            src={loyaltyHowItWorksPageContent.hero.imageSrc}
            alt={loyaltyHowItWorksPageContent.hero.imageAlt}
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(247,243,238,0.92)_0%,rgba(247,243,238,0.72)_28%,rgba(247,243,238,0.18)_54%,rgba(247,243,238,0.06)_100%)]" />
          <div className="absolute inset-y-0 left-0 flex max-w-xl items-center px-8 md:px-12">
            <div>
              <p className="text-sm uppercase tracking-[0.32em] text-[#a8826c]">Promos</p>
              <h1 className="mt-4 text-4xl font-semibold text-[#6f2b2b] md:text-6xl">
                {loyaltyHowItWorksPageContent.hero.title}
              </h1>
            </div>
          </div>
        </div>
      </header>

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        {loyaltyHowItWorksPageContent.steps.map((step, index) => (
          <article key={step.title} className="min-h-[320px] rounded-sm border border-[#eadfd7] bg-[#fffdfa] px-8 py-10 text-center shadow-[0_12px_30px_rgba(98,52,41,0.06)]">
            <p className="text-3xl font-medium text-[#7b2d2d]">
              {(index + 1).toString().padStart(2, "0")}
            </p>
            <h2 className="mt-12 text-3xl font-medium leading-tight text-[#7b2d2d] md:text-4xl">
              {step.title.replace(/^\d+\.\s*/, "")}
            </h2>
            {step.detail ? (
              <p className="mt-10 text-xl font-medium text-[#7b2d2d]">{step.detail}</p>
            ) : null}
            <p className="mt-4 text-base leading-8 text-[#8a5959]">{step.body}</p>
          </article>
        ))}
      </div>

      <section className="mt-10 rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-8">
        <h2 className="text-2xl font-semibold text-[#6f2b2b]">How it works right now</h2>
        <ul className="mt-5 space-y-3 text-sm leading-7 text-[#5f4040]">
          {loyaltyHowItWorksPageContent.highlights.map((item) => (
            <li key={item} className="rounded-xl bg-[#faf4ef] px-4 py-3">
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <p className="text-sm leading-7 text-[#7f5a5a]">{loyaltyHowItWorksPageContent.support}</p>
          <Link
            href="/dashboard"
            className="inline-flex rounded-full border border-[#d6c6ba] bg-[#fff] px-5 py-2.5 text-sm font-medium text-[#6e3232] transition-all hover:-translate-y-0.5 hover:shadow"
          >
            View your dashboard
          </Link>
        </div>
      </section>
    </section>
  );
}
