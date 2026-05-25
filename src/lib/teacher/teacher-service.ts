import { Role } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  addSessionAttendeeByManager,
  getAdminSessionById,
  getAdminSessionOptions,
  getAdminSessionsData,
  removeSessionAttendeeByManager,
} from "@/lib/admin/admin-service";
import { assertTeacherSelfScope, assertTeacherSessionScope } from "@/lib/teacher/teacher-helpers";
import {
  assertCanonicalMediaPublicPath,
  getCanonicalMediaRenderState,
} from "@/lib/media";

export type TeacherProfileData = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  image: string;
  phone: string;
  bio: string;
  specialties: string[];
  certifications: string[];
};

export async function getTeacherSelfProfile(teacherUserId: string): Promise<TeacherProfileData | null> {
  const teacher = await prisma.user.findUnique({
    where: { id: teacherUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      name: true,
      email: true,
      image: true,
      role: true,
      teacherProfile: {
        select: {
          phone: true,
          bio: true,
          specialties: true,
          certifications: true,
        },
      },
    },
  });

  if (!teacher || teacher.role !== Role.TEACHER) {
    return null;
  }

  return {
    id: teacher.id,
    firstName: teacher.firstName ?? "",
    lastName: teacher.lastName ?? "",
    fullName: teacher.name,
    email: teacher.email,
    image: await getTeacherImageRenderPath(teacher.image),
    phone: teacher.teacherProfile?.phone ?? "",
    bio: teacher.teacherProfile?.bio ?? "",
    specialties: teacher.teacherProfile?.specialties ?? [],
    certifications: teacher.teacherProfile?.certifications ?? [],
  };
}

export async function updateTeacherSelfProfile(input: {
  teacherUserId: string;
  requestedTeacherUserId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  bio?: string;
  specialties?: string[];
  certifications?: string[];
}) {
  assertTeacherSelfScope({
    teacherUserId: input.teacherUserId,
    requestedTeacherUserId: input.requestedTeacherUserId,
  });

  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  if (!firstName || !lastName) {
    throw new Error("INVALID_TEACHER_PROFILE_INPUT");
  }

  const existing = await prisma.user.findUnique({
    where: { id: input.teacherUserId },
    select: {
      id: true,
      role: true,
    },
  });
  if (!existing || existing.role !== Role.TEACHER) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: input.teacherUserId },
      data: {
        firstName,
        lastName,
        name: `${firstName} ${lastName}`.trim(),
      },
    });

    await tx.teacherProfile.upsert({
      where: { userId: input.teacherUserId },
      update: {
        phone: input.phone?.trim() || null,
        bio: input.bio?.trim() || null,
        specialties: input.specialties ?? [],
        certifications: input.certifications ?? [],
      },
      create: {
        userId: input.teacherUserId,
        phone: input.phone?.trim() || null,
        bio: input.bio?.trim() || null,
        specialties: input.specialties ?? [],
        certifications: input.certifications ?? [],
      },
    });
  });
}

export async function updateTeacherSelfImage(input: {
  teacherUserId: string;
  requestedTeacherUserId: string;
  imagePath: string;
}) {
  assertTeacherSelfScope({
    teacherUserId: input.teacherUserId,
    requestedTeacherUserId: input.requestedTeacherUserId,
  });

  const trimmed = input.imagePath.trim();
  const imagePath = assertCanonicalMediaPublicPath(trimmed, ["teachers"]);
  const existing = await prisma.user.findUnique({
    where: { id: input.teacherUserId },
    select: {
      id: true,
      role: true,
    },
  });
  if (!existing || existing.role !== Role.TEACHER) {
    throw new Error("TEACHER_NOT_FOUND");
  }

  return prisma.user.update({
    where: { id: existing.id },
    data: { image: imagePath },
    select: {
      id: true,
      image: true,
    },
  });
}

async function getTeacherImageRenderPath(imagePath: string | null): Promise<string> {
  if (!imagePath) {
    return "";
  }

  const trimmed = imagePath.trim();
  if (!trimmed) {
    return "";
  }

  const renderState = await getCanonicalMediaRenderState(trimmed, { allowedFolders: ["teachers"] });
  return renderState.src ?? "";
}

export async function getTeacherAssignedSessions(input: {
  teacherUserId: string;
  weekStart?: Date;
  weekEnd?: Date;
}) {
  return getAdminSessionsData({
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    teacherId: input.teacherUserId,
  });
}

export async function getTeacherSessionRosterData(input: {
  teacherUserId: string;
  sessionId: string;
}) {
  const session = await getAdminSessionById(input.sessionId);
  if (!session) {
    return null;
  }

  assertTeacherSessionScope({
    teacherUserId: input.teacherUserId,
    sessionTeacherId: session.teacherId,
  });

  const options = await getAdminSessionOptions(input.sessionId);
  return {
    session,
    clients: options.clients,
  };
}

export async function addTeacherSessionAttendee(input: {
  teacherUserId: string;
  studioSessionId: string;
  clientId: string;
  note?: string;
}) {
  return addSessionAttendeeByManager({
    studioSessionId: input.studioSessionId,
    clientId: input.clientId,
    note: input.note,
    actor: {
      userId: input.teacherUserId,
      role: Role.TEACHER,
    },
  });
}

export async function removeTeacherSessionAttendee(input: {
  teacherUserId: string;
  studioSessionId: string;
  bookingId: string;
  note?: string;
}) {
  return removeSessionAttendeeByManager({
    studioSessionId: input.studioSessionId,
    bookingId: input.bookingId,
    note: input.note,
    actor: {
      userId: input.teacherUserId,
      role: Role.TEACHER,
    },
  });
}
