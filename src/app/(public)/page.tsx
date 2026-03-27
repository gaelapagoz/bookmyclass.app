import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { siteConfig } from "@/lib/site-config";
import { createContactMessage } from "@/lib/client-messages/client-message-service";
import { getActiveAgendaPdfDocument } from "@/lib/public-documents/agenda-document-service";

const weeklyAgenda = [
  {
    day: "Monday",
    classes: ["18:00–19:00 Pilates with Props", "19:00–20:30 Rocket Vinyasa Yoga (Level 1/2)"],
  },
  {
    day: "Tuesday",
    classes: ["18:00–19:00 Pilates Functional Training (TRX)", "19:15–20:15 Vinyasa Yoga (Level 1/2)"],
  },
  {
    day: "Wednesday",
    classes: ["18:00–19:00 Pilates & Functional Training (TRX)", "19:15–20:15 Vinyasa Yoga (Level 1/2)"],
  },
  {
    day: "Thursday",
    classes: ["18:00–19:00 Pilates Stretch & Tone", "19:15–20:15 Rocket Vinyasa Yoga (Level 1)"],
  },
  {
    day: "Friday",
    classes: [],
  },
  {
    day: "Saturday",
    classes: ["10:30–11:30 Pilates with Props"],
  },
] as const;

const serviceCards = [
  {
    icon: "●",
    title: "Collective Classes",
    description: "Small group yoga and pilates sessions in Brussels",
  },
  {
    icon: "◐",
    title: "Private Coaching",
    description: "One-on-one sessions tailored to your goals",
  },
  {
    icon: "○",
    title: "Online Programs",
    description: "Practice anytime with structured video programs",
  },
  {
    icon: "◍",
    title: "Classes at Work",
    description: "Wellness experiences for teams and companies",
  },
] as const;

function headingClassName(size: "lg" | "md" = "lg") {
  return `${size === "lg" ? "text-3xl md:text-5xl" : "text-2xl md:text-4xl"} font-semibold tracking-tight text-[#682c2f]`;
}

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(180),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().min(1).max(2000),
});

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; error?: string }>;
}) {
  const params = await searchParams;
  const agendaPdf = await getActiveAgendaPdfDocument();
  const contactSent = params.contact === "sent";
  const contactError = params.error === "contact_failed";

  async function submitContactAction(formData: FormData) {
    "use server";

    const parsed = contactSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone") || undefined,
      message: formData.get("message"),
    });

    if (!parsed.success) {
      console.error("[home/contact] validation failed", {
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      redirect("/?error=contact_failed");
    }

    try {
      await createContactMessage({
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone ?? null,
        subject: "Contact form",
        message: parsed.data.message,
      });
    } catch (error) {
      console.error("[home/contact] createContactMessage failed", error);
      redirect("/?error=contact_failed");
    }

    redirect("/?contact=sent");
  }

  return (
    <div className="bg-[#f7f3ee] text-[#5a4b47]">
      <section className="relative min-h-[78vh] overflow-hidden">
        <Image
          src="/images/yoga-split-main.jpg"
          alt="Woman practicing front split in a calm natural setting"
          fill
          priority
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1f1414]/70 via-[#1f1414]/45 to-[#1f1414]/10" />
        <div className="relative mx-auto flex min-h-[78vh] w-full max-w-6xl items-center px-6 py-20 md:px-10">
          <div className="max-w-2xl">
            <p className="mb-4 inline-flex rounded-full border border-[#e7d7cc]/70 bg-[#f5ece5]/20 px-4 py-1 text-xs tracking-[0.2em] text-[#f7efe8]">
              Brussels
            </p>
            <h1
              className={`${headingClassName("lg")} text-[#fffaf6]`}
              style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}
            >
              Move Better. Feel Stronger. Slow Down.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[#f5ece5]">
              Yoga, Pilates & Functional Training in small group classes with personal attention
            </p>
            <p className="mt-4 text-base font-medium text-[#d9a4a6]">Private Coaching & Reformer Classes</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/book-a-class"
                className="rounded-full bg-[#7b2d2d] px-6 py-3 text-sm font-medium text-[#f8efea] shadow-lg shadow-[#1b1313]/30 transition-all hover:-translate-y-0.5 hover:bg-[#8b3434]"
              >
                Book a Class
              </Link>
              <Link
                href="#agenda"
                className="rounded-full border border-[#f2e5db] bg-[#f7f1ea]/10 px-6 py-3 text-sm font-medium text-[#fffaf6] backdrop-blur transition-all hover:-translate-y-0.5 hover:bg-[#f7f1ea]/20"
              >
                View Schedule
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="agenda" className="mx-auto w-full max-w-6xl px-6 py-20 md:px-10">
        <h2 className={headingClassName("md")} style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}>
          Weekly Agenda
        </h2>
        <p className="mt-3 text-base text-[#7f6660]">Find the class that fits your rhythm</p>

        <div className="mt-8 rounded-3xl border border-[#e4d8cf] bg-[#fffdfa] p-4 shadow-[0_18px_45px_-30px_rgba(39,22,22,0.45)] md:p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            {weeklyAgenda.map((entry) => (
              <article key={entry.day} className="rounded-2xl border border-[#eee3db] bg-[#fff] p-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#6e3232]">{entry.day}</h3>
                {entry.classes.length > 0 ? (
                  <ul className="mt-3 space-y-3 text-sm leading-relaxed text-[#5f504b]">
                    {entry.classes.map((className) => (
                      <li key={className} className="rounded-xl bg-[#faf4ef] px-3 py-2">
                        {className}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-[#9a8680]">No classes</p>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="mt-8">
          {agendaPdf ? (
            <Link
              href={agendaPdf.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-full border border-[#d6c6ba] bg-[#fff] px-6 py-3 text-sm font-medium text-[#6e3232] shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c8b3a4] hover:shadow"
            >
              Download Full Agenda
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed rounded-full border border-[#d6c6ba] bg-[#fff] px-6 py-3 text-sm font-medium text-[#a3897e] shadow-sm"
            >
              Agenda Coming Soon
            </button>
          )}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-8 md:px-10">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <article className="rounded-3xl border border-[#eadfd7] bg-[#fffdfa] p-8 shadow-[0_18px_35px_-30px_rgba(47,25,25,0.45)]">
            <h3
              className="text-2xl font-semibold text-[#692f32]"
              style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}
            >
              Book a Class
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#6f605b]">
              Join a small group session and experience guided, personalized practice.
            </p>
            <Link
              href="/book-a-class"
              className="mt-6 inline-flex rounded-full bg-[#7b2d2d] px-5 py-2.5 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
            >
              Book a Class
            </Link>
          </article>

          <article className="rounded-3xl border border-[#eadfd7] bg-[#fffdfa] p-8 shadow-[0_18px_35px_-30px_rgba(47,25,25,0.45)]">
            <h3
              className="text-2xl font-semibold text-[#692f32]"
              style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}
            >
              Subscriptions
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-[#6f605b]">
              Flexible plans designed to support your consistency and progress.
            </p>
            <Link
              href="/subscription"
              className="mt-6 inline-flex rounded-full bg-[#7b2d2d] px-5 py-2.5 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
            >
              View Subscriptions
            </Link>
          </article>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 py-20 md:px-10">
        <h2 className={headingClassName("md")} style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}>
          Our Services
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {serviceCards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-6">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#f6ece6] text-[#7b2d2d]">
                {card.icon}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-[#6f2b2b]">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#6f605b]">{card.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-20 md:px-10">
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          <div className="relative min-h-[320px] overflow-hidden rounded-3xl border border-[#eadfd7]">
            <Image src="/images/yoga-split-main.jpg" alt="Studio atmosphere" fill className="object-cover" />
          </div>
          <article className="rounded-3xl border border-[#eadfd7] bg-[#fffdfa] p-8 shadow-[0_18px_35px_-30px_rgba(47,25,25,0.45)] md:p-10">
            <h2 className={headingClassName("md")} style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}>
              A Space to Reconnect with Your Body
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[#6f605b]">
              Our studio focuses on small group classes to ensure personal attention and real progress. Each session
              blends strength, mobility, and mindful movement in a calm and supportive environment.
            </p>
            <Link
              href="/about/studio"
              className="mt-7 inline-flex rounded-full border border-[#d6c6ba] bg-[#fff] px-5 py-2.5 text-sm font-medium text-[#6e3232] transition-all hover:-translate-y-0.5 hover:shadow"
            >
              About Us
            </Link>
          </article>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-6 pb-24 md:px-10">
        <h2 className={headingClassName("md")} style={{ fontFamily: "Iowan Old Style, Baskerville, Georgia, serif" }}>
          Visit the Studio
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-[#eadfd7] bg-[#fffdfa] p-8">
            <p className="text-sm leading-relaxed text-[#6f605b]">
              Avenue de Tervueren, Merode
              <br />
              Brussels, Belgium
            </p>
            <p className="mt-4 text-sm text-[#6f605b]">{siteConfig.contactEmail}</p>
            <div className="mt-6 overflow-hidden rounded-2xl border border-[#eadfd7]">
              <iframe
                title="Yoga Pilates Fitness Studio map"
                src="https://www.google.com/maps?q=Brussels&output=embed"
                className="h-64 w-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </article>

          <form action={submitContactAction} className="rounded-3xl border border-[#eadfd7] bg-[#fffdfa] p-8">
            {contactSent ? <p className="mb-4 text-sm text-[#2f6b35]">Message sent successfully.</p> : null}
            {contactError ? (
              <p className="mb-4 text-sm text-[#7b2d2d]">Could not send your message. Please try again.</p>
            ) : null}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <input
                type="text"
                name="name"
                placeholder="Name"
                required
                className="rounded-xl border border-[#e4d8cf] bg-[#fff] px-4 py-3 text-sm outline-none transition focus:border-[#cba4a4]"
              />
              <input
                type="email"
                name="email"
                placeholder="Email"
                required
                className="rounded-xl border border-[#e4d8cf] bg-[#fff] px-4 py-3 text-sm outline-none transition focus:border-[#cba4a4]"
              />
              <input
                type="tel"
                name="phone"
                placeholder="Phone"
                className="rounded-xl border border-[#e4d8cf] bg-[#fff] px-4 py-3 text-sm outline-none transition focus:border-[#cba4a4] sm:col-span-2"
              />
              <textarea
                name="message"
                placeholder="Message"
                rows={5}
                required
                className="rounded-xl border border-[#e4d8cf] bg-[#fff] px-4 py-3 text-sm outline-none transition focus:border-[#cba4a4] sm:col-span-2"
              />
            </div>
            <button
              type="submit"
              className="mt-6 rounded-full bg-[#7b2d2d] px-6 py-3 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
            >
              Submit
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}


