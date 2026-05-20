import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@/auth";
import LearningVideoGate from "@/components/learning/LearningVideoGate";
import NotFoundPage from "@/components/common/NotFoundPage";
import {
  fromCourseTypeRouteKey,
  getLearningCourseByCourseTypeAndLegacyId,
  getLearningProgramByCourseType,
  toCourseTypeRouteKey,
  toEmbedUrl,
} from "@/lib/learning/catalogue";

export default async function LearningCoursePage({
  params,
}: {
  params: Promise<{ courseType: string; courseId: string }>;
}) {
  const { courseType: rawCourseType, courseId } = await params;
  const courseType = fromCourseTypeRouteKey(rawCourseType);

  const [program, course, session] = await Promise.all([
    getLearningProgramByCourseType(courseType),
    getLearningCourseByCourseTypeAndLegacyId(courseType, courseId),
    auth(),
  ]);

  if (!program || !course) {
    notFound();
  }

  const iframeUrl = toEmbedUrl(course.videoUrl);
  if (!iframeUrl) {
    return <NotFoundPage />;
  }

  const targetHref = `/learning/${toCourseTypeRouteKey(program.courseType)}/${encodeURIComponent(
    course.legacyId,
  )}`;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12">
      <Link
        href={`/learning/${toCourseTypeRouteKey(program.courseType)}`}
        className="text-sm font-medium text-[#7b2d2d] underline underline-offset-4 hover:opacity-80"
      >
        Back to {program.courseType}
      </Link>

      <div className="mt-5">
        <h1 className="text-3xl font-semibold text-[#6f2b2b] md:text-4xl">{course.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#6f605b] md:text-base">
          {course.description ?? "Course description coming soon."}
        </p>
      </div>

      <div className="mt-8">
        <LearningVideoGate
          isAuthenticated={Boolean(session?.user)}
          iframeUrl={iframeUrl}
          targetHref={targetHref}
          title={course.title}
        />
      </div>
    </section>
  );
}
