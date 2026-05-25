import { Role } from "@prisma/client";
import { prisma } from "../db";
import { getPublicTeacherName } from "./teacher-display";
import { getCanonicalMediaRenderState } from "@/lib/media";

export type PublicInstructor = {
  bio: string;
  id: string;
  imageUrl: string;
  name: string;
};

export async function getPublicInstructors(): Promise<PublicInstructor[]> {
  const teachers = await prisma.user.findMany({
    where: {
      role: Role.TEACHER,
      teacherProfile: {
        isNot: null,
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      image: true,
      teacherProfile: {
        select: {
          bio: true,
        },
      },
    },
  });

  return Promise.all(
    teachers.map(async (teacher) => ({
      id: teacher.id,
      name: getPublicTeacherName(teacher),
      bio: teacher.teacherProfile?.bio?.trim() ?? "",
      imageUrl: await getTeacherImageUrl(teacher.image),
    })),
  );
}

async function getTeacherImageUrl(imagePath: string | null): Promise<string> {
  const trimmed = imagePath?.trim();
  if (!trimmed) {
    return "";
  }

  const renderState = await getCanonicalMediaRenderState(trimmed, { allowedFolders: ["teachers"] });
  return renderState.src ?? "";
}
