import prisma from "@/lib/db";
import { toLegacyLearningProgram } from "@/lib/learning-platform/legacy-mappers";

export async function GET() {
  try {
    const programs = await prisma.learningProgram.findMany({
      orderBy: {
        legacyId: "asc",
      },
    });

    return Response.json(programs.map(toLegacyLearningProgram), { status: 200 });
  } catch (error) {
    console.error("[api/programs] Failed to fetch learning programs.", error);
    return Response.json(
      { error: "Failed to fetch learning programs from the database." },
      { status: 500 },
    );
  }
}
