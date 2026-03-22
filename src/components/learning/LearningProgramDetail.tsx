import Link from "next/link";
import {
  toCourseTypeRouteKey,
  toEmbedUrl,
  type LearningCourseView,
  type LearningProgramView,
} from "@/lib/learning/catalogue";

type LearningProgramDetailProps = {
  program: LearningProgramView;
  courses: LearningCourseView[];
  currentPage: number;
  totalPages: number;
};

export default function LearningProgramDetail({
  program,
  courses,
  currentPage,
  totalPages,
}: LearningProgramDetailProps) {
  const promoVideoUrl = toEmbedUrl(program.videoPromo);
  const basePath = `/learning/${toCourseTypeRouteKey(program.courseType)}`;
  const classesAnchorId = "program-classes";

  const buildPageHref = (page: number) =>
    page <= 1
      ? `${basePath}#${classesAnchorId}`
      : `${basePath}?page=${page}#${classesAnchorId}`;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <Link
        href="/learning"
        className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
      >
        Back to programs
      </Link>

      <header className="mt-4 rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-8 shadow-[0_18px_35px_-30px_rgba(47,25,25,0.45)] md:p-10">
        <h1 className="text-3xl font-semibold text-[#6f2b2b] md:text-4xl">
          {program.title}
        </h1>
        {program.mainDescription ? (
          <p className="mt-4 text-sm leading-relaxed text-[#6f605b] md:text-base">
            {program.mainDescription}
          </p>
        ) : null}
      </header>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <article className="rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-6">
          <h2 className="text-2xl font-semibold text-[#6f2b2b]">About this program</h2>
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#6f605b] md:text-base">
            {program.description1 ?? "Program description coming soon."}
          </p>
        </article>

        <article className="rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-6">
          <h2 className="text-2xl font-semibold text-[#6f2b2b]">What you will learn</h2>
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#6f605b] md:text-base">
            {program.description2 ?? "Learning objectives will be listed soon."}
          </p>
        </article>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <article className="rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-6">
          <h2 className="text-2xl font-semibold text-[#6f2b2b]">Program includes</h2>
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-[#6f605b] md:text-base">
            {program.description3 ?? "Program inclusions will be listed soon."}
          </p>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[#eadfd7] bg-[#fffdfa]">
          {promoVideoUrl ? (
            <iframe
              src={promoVideoUrl}
              title={`${program.title} promo`}
              className="h-full min-h-[320px] w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <div className="flex min-h-[320px] items-center justify-center px-6 text-sm text-[#8a5959]">
              Promo video unavailable
            </div>
          )}
        </article>
      </div>

      <section id={classesAnchorId} className="mt-10 scroll-mt-32">
        <h2 className="text-2xl font-semibold text-[#6f2b2b] md:text-3xl">
          Classes in this program
        </h2>

        {courses.length === 0 ? (
          <p className="mt-4 text-sm text-[#7f5a5a]">
            No classes are available for this program yet.
          </p>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
            {courses.map((course) => (
              <article
                key={course.legacyId}
                className="rounded-2xl border border-[#eadfd7] bg-[#fffdfa] p-4"
              >
                {course.thumbnail ? (
                  <img
                    src={course.thumbnail}
                    alt={course.title}
                    className="h-56 w-full rounded-xl object-cover"
                  />
                ) : null}
                <h3 className="mt-4 text-xl font-semibold text-[#6f2b2b]">{course.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#6f605b]">
                  {course.shortDescription ?? course.description ?? "Course description coming soon."}
                </p>
                <Link
                  href={`${basePath}/${encodeURIComponent(course.legacyId)}`}
                  className="mt-4 inline-flex rounded-md bg-[#7b2d2d] px-4 py-2 text-sm font-medium text-[#f8efea] transition-colors hover:bg-[#8b3434]"
                >
                  Open Course
                </Link>
              </article>
            ))}
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            className="mt-8 flex flex-wrap items-center gap-2"
            aria-label="Program classes pagination"
          >
            <Link
              href={buildPageHref(Math.max(1, currentPage - 1))}
              aria-disabled={currentPage === 1}
              className={`rounded-md border px-3 py-2 text-sm ${
                currentPage === 1
                  ? "pointer-events-none border-[#d8cec6] text-[#b49a9a]"
                  : "border-[#c7b7aa] text-[#7b2d2d] hover:bg-[#f2ede7]"
              }`}
            >
              Previous
            </Link>

            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <Link
                key={page}
                href={buildPageHref(page)}
                aria-current={page === currentPage ? "page" : undefined}
                className={`rounded-md px-3 py-2 text-sm ${
                  page === currentPage
                    ? "bg-[#7b2d2d] text-[#f8efea]"
                    : "border border-[#c7b7aa] text-[#7b2d2d] hover:bg-[#f2ede7]"
                }`}
              >
                {page}
              </Link>
            ))}

            <Link
              href={buildPageHref(Math.min(totalPages, currentPage + 1))}
              aria-disabled={currentPage === totalPages}
              className={`rounded-md border px-3 py-2 text-sm ${
                currentPage === totalPages
                  ? "pointer-events-none border-[#d8cec6] text-[#b49a9a]"
                  : "border-[#c7b7aa] text-[#7b2d2d] hover:bg-[#f2ede7]"
              }`}
            >
              Next
            </Link>
          </nav>
        ) : null}
      </section>
    </section>
  );
}
