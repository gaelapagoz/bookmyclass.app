import { termsPageContent } from "@/lib/public-content/about-content";

export default function AboutTermsAndConditionsPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="rounded-2xl border border-[#e5d7cb] bg-[#fffdfa] p-8">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">{termsPageContent.hero.title}</h1>
        <p className="mt-4 text-base leading-7 text-[#5f4040]">{termsPageContent.hero.intro}</p>
      </header>

      <div className="mt-8 space-y-5">
        {termsPageContent.sections.map((section) => (
          <article key={section.title} className="rounded-xl border border-[#eadfd7] bg-[#fffdfa] p-6">
            <h2 className="text-xl font-semibold text-[#6f2b2b]">{section.title}</h2>
            <div className="mt-3 space-y-3 text-sm leading-7 text-[#5f4040]">
              {section.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
