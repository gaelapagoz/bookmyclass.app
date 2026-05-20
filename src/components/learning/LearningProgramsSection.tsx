import Link from "next/link";
import {
  toCourseTypeRouteKey,
  type LearningProgramView,
} from "@/lib/learning/catalogue";

type LearningProgramsSectionProps = {
  programs: LearningProgramView[];
};

export default function LearningProgramsSection({
  programs,
}: LearningProgramsSectionProps) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-[#6f2b2b] md:text-4xl">
        Online Learning Programs
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#6f605b] md:text-base">
        Explore guided programs and browse classes by category. Sign in is only
        required when you want to watch a video.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-8">
        {programs.map((program, index) => (
          <article
            key={program.legacyId}
            className="overflow-hidden rounded-2xl border border-[#eadfd7] bg-[#fffdfa] shadow-[0_18px_35px_-30px_rgba(47,25,25,0.45)]"
          >
            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${
                index % 2 === 0 ? "" : "md:[&>div:first-child]:order-2"
              }`}
            >
              <div className="h-full min-h-[280px] bg-[#f7f3ee]">
                {program.picture1 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={program.picture1}
                    alt={program.courseType}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-[#8a5959]">
                    No image available
                  </div>
                )}
              </div>

              <div className="flex items-center p-8 md:p-10">
                <div>
                  <h2 className="text-2xl font-semibold text-[#6f2b2b] md:text-3xl">
                    {program.courseType}
                  </h2>
                  <p className="mt-4 text-sm leading-relaxed text-[#6f605b] md:text-base">
                    {program.mainDescription ?? "Program details coming soon."}
                  </p>

                  <Link
                    href={`/learning/${toCourseTypeRouteKey(program.courseType)}`}
                    className="mt-6 inline-flex rounded-full bg-[#7b2d2d] px-5 py-2.5 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
                  >
                    Explore Program
                  </Link>
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
