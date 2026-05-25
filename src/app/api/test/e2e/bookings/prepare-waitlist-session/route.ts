import { BookingStatus, Role, StudioSessionStatus, WaitlistStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";
import { clearPublicCatalogueAvailabilityCaches } from "@/lib/public-catalogue/availability-service";
import { getStudioDateKey, getStudioTimeLabel } from "@/lib/public-catalogue/timezone";

const payloadSchema = z.object({
  clientEmail: z.string().trim().email(),
  createWaitlistEntry: z.boolean().optional().default(false),
  serviceSlug: z.string().trim().min(1).max(120),
});

const PREPARED_TITLE_PREFIX = "E2E Waitlist Frontend";
const PREPARED_TEMPLATE_SLUG_PREFIX = "e2e-waitlist-tpl-";

function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

  try {
    const client = await prisma.user.findFirst({
      where: {
        email: {
          equals: parsed.data.clientEmail,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });
    const classType = await prisma.classType.findFirst({
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
    });

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

    // Clean up expired prepared sessions and their per-call templates.
    const now = new Date();
    const oldPreparedSessions = await prisma.studioSession.findMany({
      where: {
        classTypeId: classType.id,
        title: { startsWith: PREPARED_TITLE_PREFIX },
        endsAt: { lt: now },
      },
      select: { id: true, classTemplateId: true },
    });

    if (oldPreparedSessions.length > 0) {
      const oldIds = oldPreparedSessions.map((s) => s.id);
      const oldTemplateIds = oldPreparedSessions.map((s) => s.classTemplateId);

      await prisma.waitlistEntry.deleteMany({ where: { studioSessionId: { in: oldIds } } });
      await prisma.booking.deleteMany({ where: { studioSessionId: { in: oldIds } } });
      await prisma.studioSession.deleteMany({ where: { id: { in: oldIds } } });

      // Remove per-call templates (identified by prefix); shared seeded templates are unaffected.
      await prisma.classTemplate.deleteMany({
        where: {
          id: { in: oldTemplateIds },
          slug: { startsWith: PREPARED_TEMPLATE_SLUG_PREFIX },
        },
      });
    }

    // Create a fresh ClassTemplate per call â€” eliminates (classTemplateId, startsAt) collision
    // even when multiple workers call this helper concurrently.
    const ts = uniqueId();
    const template = await prisma.classTemplate.create({
      data: {
        classTypeId: classType.id,
        defaultTeacherId: referenceSession.teacherId,
        title: `${PREPARED_TITLE_PREFIX} Template ${ts}`,
        slug: `${PREPARED_TEMPLATE_SLUG_PREFIX}${ts}`,
        defaultCapacity: 4,
        defaultDurationMinutes: 60,
        isActive: true,
        isPublished: true,
      },
      select: { id: true },
    });

    // Fixed time within calendar view window; no offset loop needed because classTemplateId is unique.
    const startsAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    startsAt.setUTCHours(10, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

    const session = await prisma.studioSession.create({
      data: {
        classTemplateId: template.id,
        classTypeId: classType.id,
        teacherId: referenceSession.teacherId,
        title: `${PREPARED_TITLE_PREFIX} ${ts}`,
        startsAt,
        endsAt,
        capacity: 4,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
      select: { id: true, startsAt: true, endsAt: true, title: true, capacity: true },
    });

    await prisma.booking.deleteMany({
      where: { clientId: client.id, studioSessionId: session.id },
    });
    await prisma.waitlistEntry.deleteMany({
      where: { clientId: client.id, studioSessionId: session.id },
    });

    const fillerTs = uniqueId();
    const fillerUsersPayload = Array.from({ length: session.capacity }).map((_, index) => ({
      name: `E2E Waitlist Filler ${index + 1}`,
      email: `e2e.waitlist.filler.${fillerTs}.${index}@bookmyclass.app`,
      role: Role.CLIENT,
    }));
    await prisma.user.createMany({
      data: fillerUsersPayload,
      skipDuplicates: true,
    });
    const fillerUsers = await prisma.user.findMany({
      where: {
        email: {
          in: fillerUsersPayload.map((item) => item.email),
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    await prisma.booking.createMany({
      data: fillerUsers.map((user) => ({
        clientId: user.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        customerName: user.name,
        customerEmail: user.email,
      })),
    });

    if (parsed.data.createWaitlistEntry) {
      await prisma.waitlistEntry.create({
        data: {
          clientId: client.id,
          studioSessionId: session.id,
          status: WaitlistStatus.ACTIVE,
          position: 1,
          joinedAt: now,
        },
      });
    }

    clearPublicCatalogueAvailabilityCaches();

    return Response.json({
      sessionId: session.id,
      serviceSlug: parsed.data.serviceSlug,
      dateKey: getStudioDateKey(session.startsAt),
      startTime: getStudioTimeLabel(session.startsAt),
      endTime: getStudioTimeLabel(session.endsAt),
      title: session.title,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[e2e/prepare-waitlist-session] unhandled error", reason);
    return Response.json(
      {
        error: "Internal server error.",
        code: "INTERNAL_SERVER_ERROR",
        ...(process.env.E2E_TEST_MODE === "1" ? { reason } : {}),
      },
      { status: 500 },
    );
  }
}

