import { StudioSessionStatus, Role } from "@prisma/client";

import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  const baseTemplate = await prisma.classTemplate.findFirst({
    where: { isActive: true },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true,
      classTypeId: true,
      title: true,
      defaultDurationMinutes: true,
      location: true,
    },
  });

  if (!baseTemplate) {
    return Response.json({ error: "No class template available for e2e fixture." }, { status: 404 });
  }

  const timestamp = Date.now();
  const teacher = await prisma.user.create({
    data: {
      name: `E2E Unassigned Teacher ${timestamp}`,
      email: `teacher.unassigned.${timestamp}@bookmyclass.local`,
      role: Role.TEACHER,
      teacherProfile: {
        create: {},
      },
    },
    select: { id: true },
  });

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + baseTemplate.defaultDurationMinutes * 60 * 1000);

  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: baseTemplate.id,
      classTypeId: baseTemplate.classTypeId,
      teacherId: teacher.id,
      title: `${baseTemplate.title} (Unassigned Fixture)`,
      location: baseTemplate.location,
      startsAt,
      endsAt,
      capacity: 8,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
    select: { id: true },
  });

  return Response.json({ sessionId: session.id }, { status: 200 });
}

