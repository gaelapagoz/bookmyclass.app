import { notFound } from "next/navigation";
import LearningProgramDetail from "@/components/learning/LearningProgramDetail";
import {
  fromCourseTypeRouteKey,
  getLearningCoursesByCourseType,
  getLearningProgramByCourseType,
} from "@/lib/learning/catalogue";

const COURSES_PER_PAGE = 6;

function parsePageParam(value: string | undefined): number {
  if (!value) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

export default async function LearningProgramPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseType: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const { courseType: rawCourseType } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const courseType = fromCourseTypeRouteKey(rawCourseType);

  const program = await getLearningProgramByCourseType(courseType);
  if (!program) {
    notFound();
  }

  const courses = await getLearningCoursesByCourseType(program.courseType);
  const totalCourses = courses.length;
  const totalPages = Math.max(1, Math.ceil(totalCourses / COURSES_PER_PAGE));
  const requestedPage = parsePageParam(resolvedSearchParams?.page);
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * COURSES_PER_PAGE;
  const paginatedCourses = courses.slice(pageStart, pageStart + COURSES_PER_PAGE);

  return (
    <LearningProgramDetail
      program={program}
      courses={paginatedCourses}
      currentPage={currentPage}
      totalPages={totalPages}
    />
  );
}
