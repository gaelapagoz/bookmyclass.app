import prisma from "@/lib/db";
import { normalizeLearningImagePath } from "@/lib/learning/image-paths";
import { getLocalMediaRenderState } from "@/lib/media";

export type LearningProgramView = {
  legacyId: string;
  mainTitle: string;
  mainDescription: string | null;
  courseType: string;
  title: string;
  description1: string | null;
  description2: string | null;
  description3: string | null;
  videoPromo: string | null;
  picture1: string | null;
  picture2: string | null;
  picture3: string | null;
};

export type LearningCourseView = {
  legacyId: string;
  title: string;
  description: string | null;
  shortDescription: string | null;
  category: string;
  categoryType: string | null;
  categoryLevel: string | null;
  thumbnail: string | null;
  videoUrl: string | null;
  priority: number;
};

async function resolveLearningImagePath(path: string | null): Promise<string | null> {
  const normalized = normalizeLearningImagePath(path);
  const renderState = await getLocalMediaRenderState(normalized, { allowedFolders: ["/images/learning"] });
  return renderState.src;
}

async function mapProgram(program: {
  legacyId: string;
  mainTitle: string;
  mainDescription: string | null;
  courseType: string;
  title: string;
  description1: string | null;
  description2: string | null;
  description3: string | null;
  videoPromo: string | null;
  picture1: string | null;
  picture2: string | null;
  picture3: string | null;
}): Promise<LearningProgramView> {
  return {
    ...program,
    picture1: await resolveLearningImagePath(program.picture1),
    picture2: await resolveLearningImagePath(program.picture2),
    picture3: await resolveLearningImagePath(program.picture3),
  };
}

async function mapCourse(course: {
  legacyId: string;
  title: string;
  description: string | null;
  shortDescription: string | null;
  category: string;
  categoryType: string | null;
  categoryLevel: string | null;
  thumbnail: string | null;
  videoUrl: string | null;
  priority: number;
}): Promise<LearningCourseView> {
  return {
    ...course,
    thumbnail: await resolveLearningImagePath(course.thumbnail),
  };
}

const learningProgramSelect = {
  legacyId: true,
  mainTitle: true,
  mainDescription: true,
  courseType: true,
  title: true,
  description1: true,
  description2: true,
  description3: true,
  videoPromo: true,
  picture1: true,
  picture2: true,
  picture3: true,
} as const;

const learningCourseSelect = {
  legacyId: true,
  title: true,
  description: true,
  shortDescription: true,
  category: true,
  categoryType: true,
  categoryLevel: true,
  thumbnail: true,
  videoUrl: true,
  priority: true,
} as const;

export async function getLearningPrograms(): Promise<LearningProgramView[]> {
  const programs = await prisma.learningProgram.findMany({
    select: learningProgramSelect,
    orderBy: { legacyId: "asc" },
  });

  return Promise.all(programs.map(mapProgram));
}

export async function getLearningProgramByCourseType(
  courseType: string,
): Promise<LearningProgramView | null> {
  const program = await prisma.learningProgram.findUnique({
    where: { courseType },
    select: learningProgramSelect,
  });

  return program ? mapProgram(program) : null;
}

export async function getLearningCoursesByCourseType(
  courseType: string,
): Promise<LearningCourseView[]> {
  const courses = await prisma.learningCourse.findMany({
    where: { category: courseType },
    select: learningCourseSelect,
    orderBy: [{ priority: "asc" }, { title: "asc" }],
  });

  return Promise.all(courses.map(mapCourse));
}

export async function getLearningCourseByCourseTypeAndLegacyId(
  courseType: string,
  courseId: string,
): Promise<LearningCourseView | null> {
  const course = await prisma.learningCourse.findUnique({
    where: { legacyId: courseId },
    select: learningCourseSelect,
  });

  if (!course || course.category !== courseType) {
    return null;
  }

  return mapCourse(course);
}

export function toEmbedUrl(url: string | null): string | null {
  if (!url) return null;

  if (url.includes("youtube.com/embed/")) return url;

  if (url.includes("youtu.be/")) {
    const id = url.split("youtu.be/")[1]?.split("?")[0];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (url.includes("watch?v=")) {
    const id = url.split("watch?v=")[1]?.split("&")[0];
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  return url;
}

export function toCourseTypeRouteKey(courseType: string): string {
  return encodeURIComponent(courseType.trim());
}

export function fromCourseTypeRouteKey(routeKey: string): string {
  const trimmed = routeKey.trim();

  try {
    return decodeURIComponent(trimmed).trim();
  } catch {
    return trimmed;
  }
}
