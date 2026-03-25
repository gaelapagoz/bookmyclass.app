import Image from "next/image";
import { studioPageContent } from "@/lib/public-content/about-content";

export default function AboutStudioPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <header className="rounded-2xl border border-[#e5d7cb] bg-[#fffdfa] p-8">
        <h1 className="text-3xl font-semibold text-[#6f2b2b]">{studioPageContent.hero.title}</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-[#5f4040]">{studioPageContent.hero.intro}</p>
      </header>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {studioPageContent.images.map((image, index) => (
          <div key={image.src} className="relative min-h-[220px] overflow-hidden rounded-xl border border-[#eadfd7]">
            <Image
              src={image.src}
              alt={image.alt}
              fill
              className="object-cover"
              sizes="(min-width: 768px) 33vw, 100vw"
              loading={index === 0 ? "eager" : "lazy"}
              priority={index === 0}
            />
          </div>
        ))}
      </div>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold text-[#6f2b2b]">Our philosophy</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {studioPageContent.philosophy.map((section) => (
            <article key={section.title} className="rounded-xl border border-[#eadfd7] bg-[#fffdfa] p-5">
              <h3 className="text-lg font-semibold text-[#6f2b2b]">{section.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[#5f4040]">{section.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-[#e5d7cb] bg-[#fffdfa] p-8">
        <h2 className="text-2xl font-semibold text-[#6f2b2b]">Types of classes</h2>
        <ul className="mt-4 space-y-3 text-sm leading-7 text-[#5f4040]">
          {studioPageContent.classTypes.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </section>
  );
}
