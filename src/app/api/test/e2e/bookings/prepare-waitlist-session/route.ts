import { BookingStatus, Role, StudioSessionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { getStudioDateKey, getStudioTimeLabel } from "@/lib/public-catalogue/timezone";

const payloadSchema = z.object({
  clientEmail: z.string().trim().email(),
  serviceSlug: z.string().trim().min(1).max(120),
});

const PREPARED_TITLE_PREFIX = "E2E Waitlist Frontend";

export async function POST(request: Request) {
  const denied = assertE2ETestRequest(request);
  if (denied) {
    return denied;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  const [client, classType] = await Promise.all([
    prisma.user.findFirst({
      where: {
        email: {
          equals: parsed.data.clientEmail,
          mode: "insensitive",
        },
      },
      select: { id: true },
    }),
    prisma.classType.findFirst({
      where: {
        slug: parsed.data.serviceSlug,
        isActive: true,
        isVisible: true,
        category: {
          isActive: true,
        },
      },
      select: {
        id: true,
        category: {
          select: {
            slug: true,
          },
        },
      },
    }),
  ]);

  if (!client) {
    return Response.json({ error: "Client not found." }, { status: 404 });
  }
  if (!classType) {
    return Response.json({ error: "Service not found." }, { status: 404 });
  }

  const categorySlug = classType.category.slug.toLowerCase();
  if (categorySlug.includes("private") || categorySlug.includes("workshop")) {
    return Response.json({ error: "Waitlist setup only supports collective classes." }, { status: 400 });
  }

  const referenceSession = await prisma.studioSession.findFirst({
    where: {
      classTypeId: classType.id,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
    orderBy: { startsAt: "asc" },
    select: {
      classTemplateId: true,
      teacherId: true,
    },
  });
  if (!referenceSession) {
    return Response.json({ error: "Reference session not found." }, { status: 404 });
  }

  const now = new Date();
  const oldPreparedSessions = await prisma.studioSession.findMany({
    where: {
      classTypeId: classType.id,
      title: {
        startsWith: PREPARED_TITLE_PREFIX,
      },
      startsAt: { gt: now },
    },
    select: { id: true },
  });
  const oldPreparedSessionIds = oldPreparedSessions.map((session) => session.id);
  if (oldPreparedSessionIds.length > 0) {
    await prisma.waitlistEntry.deleteMany({
      where: {
        studioSessionId: {
          in: oldPreparedSessionIds,
        },
      },
    });
    await prisma.booking.deleteMany({
      where: {
        studioSessionId: {
          in: oldPreparedSessionIds,
        },
      },
    });
    await prisma.studioSession.deleteMany({
      where: {
        id: {
          in: oldPreparedSessionIds,
        },
      },
    });
  }

  const startsAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  startsAt.setUTCMinutes(0, 0, 0);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const session = await prisma.studioSession.create({
    data: {
      classTemplateId: referenceSession.classTemplateId,
      classTypeId: classType.id,
      teacherId: referenceSession.teacherId,
      title: `${PREPARED_TITLE_PREFIX} ${startsAt.toISOString()}`,
      startsAt,
      endsAt,
      capacity: 4,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
    select: { id: true, startsAt: true, endsAt: true, title: true, capacity: true },
  });

  await Promise.all([
    prisma.booking.deleteMany({
      where: {
        clientId: client.id,
        studioSessionId: session.id,
      },
    }),
    prisma.waitlistEntry.deleteMany({
      where: {
        clientId: client.id,
        studioSessionId: session.id,
      },
    }),
  ]);

  const fillerUsers = await Promise.all(
    Array.from({ length: session.capacity }).map((_, index) =>
      prisma.user.create({
        data: {
          name: `E2E Waitlist Filler ${index + 1}`,
          email: `e2e.waitlist.filler.${Date.now()}.${index}@example.test`,
          role: Role.CLIENT,
        },
      })
    ),
  );

  await prisma.booking.createMany({
    data: fillerUsers.map((user) => ({
      clientId: user.id,
      studioSessionId: session.id,
      status: BookingStatus.CONFIRMED,
      customerName: user.name,
      customerEmail: user.email,
    })),
  });

  return Response.json({
    sessionId: session.id,
    serviceSlug: parsed.data.serviceSlug,
    dateKey: getStudioDateKey(session.startsAt),
    startTime: getStudioTimeLabel(session.startsAt),
    endTime: getStudioTimeLabel(session.endsAt),
    title: session.title,
  });
}
