import { faqPageContent } from "@/lib/public-content/about-content";

export default function AboutFaqPage() {
  return (
    <section className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="rounded-2xl border border-[#e5d7cb] bg-[#fffdfa] p-8">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">{faqPageContent.hero.title}</h1>
        <p className="mt-4 text-base leading-7 text-[#5f4040]">{faqPageContent.hero.intro}</p>
      </header>

      <div className="mt-8 space-y-5">
        {faqPageContent.items.map((item) => (
          <article key={item.id} className="rounded-xl border border-[#eadfd7] bg-[#fffdfa] p-6">
            <h2 className="text-xl font-semibold text-[#6f2b2b]">{item.question}</h2>
            <p className="mt-3 text-sm leading-7 text-[#5f4040]">{item.answer}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
