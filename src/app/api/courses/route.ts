import prisma from "@/lib/db";
import { toLegacyLearningCourse } from "@/lib/learning-platform/legacy-mappers";

export async function GET() {
  try {
    const courses = await prisma.learningCourse.findMany({
      orderBy: [{ priority: "asc" }, { title: "asc" }],
    });

    return Response.json(courses.map(toLegacyLearningCourse), { status: 200 });
  } catch (error) {
    console.error("[api/courses] Failed to fetch learning courses.", error);
    return Response.json(
      { error: "Failed to fetch learning courses from the database." },
      { status: 500 },
    );
  }
}
