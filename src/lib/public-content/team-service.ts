import { Role } from "@prisma/client";
import { prisma } from "../db";
import { getPublicTeacherName } from "./teacher-display";

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

  return teachers.map((teacher) => ({
    id: teacher.id,
    name: getPublicTeacherName(teacher),
    bio: teacher.teacherProfile?.bio?.trim() ?? "",
    imageUrl: teacher.image?.trim() ?? "",
  }));
}
