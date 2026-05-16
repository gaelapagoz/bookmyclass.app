import {
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  ProductType,
  Role,
  StudioSessionStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";

const payloadSchema = z.object({
  clientEmail: z.string().trim().email(),
  mode: z.enum(["in_window", "before_window", "after_window"]).optional(),
  classMode: z.enum(["collective", "private"]).optional(),
});

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
    let user = await prisma.user.findFirst({
      where: {
        email: {
          equals: parsed.data.clientEmail,
          mode: "insensitive",
        },
      },
      select: { id: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: "E2E Kiosk Client",
          email: parsed.data.clientEmail,
          role: Role.CLIENT,
        },
        select: { id: true },
      });
    }

    let entitlement = await prisma.clientEntitlement.findFirst({
      where: {
        clientId: user.id,
        entitlementType: {
          in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
        },
        status: "ACTIVE",
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (!entitlement) {
      let product = await prisma.product.findFirst({
        where: {
          productType: ProductType.CLASS_PACK,
          isActive: true,
          isArchived: false,
        },
        select: { id: true },
      });

      if (!product) {
        const ts = uniqueId();
        product = await prisma.product.create({
          data: {
            name: `E2E check-in pack ${ts}`,
            slug: `e2e-checkin-pack-${ts}`,
            productType: ProductType.CLASS_PACK,
            isActive: true,
            isArchived: false,
            sortOrder: 9999,
          },
          select: { id: true },
        });
      }

      entitlement = await prisma.clientEntitlement.create({
        data: {
          clientId: user.id,
          productId: product.id,
          entitlementType: EntitlementType.CREDIT_PACK,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          status: ClientEntitlementStatus.ACTIVE,
          activatedAt: new Date(),
        },
        select: { id: true },
      });

      await prisma.creditLedgerEntry.create({
        data: {
          clientId: user.id,
          entitlementId: entitlement.id,
          entryType: CreditLedgerEntryType.GRANT,
          amount: 5,
          notes: "E2E check-in preparation grant.",
        },
      });
    }

    const classMode = parsed.data.classMode ?? "collective";
    const mode = parsed.data.mode ?? "in_window";
    const ts = uniqueId();

    let classTypeId: string;
    let classTemplateId: string;
    let teacherId: string;

    if (classMode === "private") {
      // Try to reuse an existing private session's classType + teacher.
      const privateRef = await prisma.studioSession.findFirst({
        where: {
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
          classType: {
            category: {
              slug: {
                contains: "private",
                mode: "insensitive",
              },
            },
          },
        },
        select: {
          classTypeId: true,
          teacherId: true,
        },
      });

      if (privateRef?.classTypeId && privateRef.teacherId) {
        classTypeId = privateRef.classTypeId;
        teacherId = privateRef.teacherId;
      } else {
        // No private session seeded — create fresh unique fixtures.
        const fallbackTeacher = await prisma.user.findFirst({
          where: { role: { in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN] } },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });

        if (!fallbackTeacher?.id) {
          return Response.json({ error: "Staff user missing for private fixture setup." }, { status: 404 });
        }

        const privateCategory = await prisma.classCategory.create({
          data: {
            name: `E2E Private Category ${ts}`,
            slug: `e2e-private-cat-${ts}`,
            sortOrder: 9990,
            isActive: true,
          },
          select: { id: true },
        });

        const privateClassType = await prisma.classType.create({
          data: {
            categoryId: privateCategory.id,
            name: `E2E Private Class ${ts}`,
            slug: `e2e-private-class-${ts}`,
            description: "E2E private kiosk exclusion fixture.",
            defaultDurationMinutes: 60,
            defaultCapacity: 10,
            isActive: true,
            isVisible: true,
            sortOrder: 9990,
          },
          select: { id: true },
        });

        classTypeId = privateClassType.id;
        teacherId = fallbackTeacher.id;
      }

      // Always create a fresh ClassTemplate per call — eliminates (classTemplateId, startsAt) race.
      const privateTemplate = await prisma.classTemplate.create({
        data: {
          classTypeId,
          defaultTeacherId: teacherId,
          title: `E2E Private Checkin Template ${ts}`,
          slug: `e2e-private-checkin-tpl-${ts}`,
          defaultCapacity: 10,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
        select: { id: true },
      });

      classTemplateId = privateTemplate.id;
    } else {
      // Collective mode — resolve classType + teacher from a seeded reference session.
      const referenceSession = await prisma.studioSession.findFirst({
        where: {
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
          teacher: {
            email: {
              equals: "teacher@bookmyclass.app",
              mode: "insensitive",
            },
          },
        },
        orderBy: { startsAt: "asc" },
        select: {
          classTypeId: true,
          teacherId: true,
        },
      });

      if (!referenceSession?.classTypeId || !referenceSession.teacherId) {
        return Response.json({ error: "Reference session data missing." }, { status: 404 });
      }

      classTypeId = referenceSession.classTypeId;
      teacherId = referenceSession.teacherId;

      // Fresh ClassTemplate per call — no (classTemplateId, startsAt) collision possible.
      const collectiveTemplate = await prisma.classTemplate.create({
        data: {
          classTypeId,
          defaultTeacherId: teacherId,
          title: `E2E Checkin Template ${ts}`,
          slug: `e2e-checkin-tpl-${ts}`,
          defaultCapacity: 20,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
        select: { id: true },
      });

      classTemplateId = collectiveTemplate.id;
    }

    const now = new Date();
    const startsAt =
      mode === "before_window"
        ? new Date(now.getTime() + 45 * 60 * 1000)
        : mode === "after_window"
          ? new Date(now.getTime() - 30 * 60 * 1000)
          : new Date(now.getTime() + 5 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const sessionTitle = `E2E check-in ${classMode} ${mode} ${ts}`;

    const session = await prisma.studioSession.create({
      data: {
        classTypeId,
        classTemplateId,
        teacherId,
        title: sessionTitle,
        startsAt,
        endsAt,
        capacity: 20,
        status: StudioSessionStatus.SCHEDULED,
        isPublished: true,
      },
      select: { id: true, title: true },
    });

    const booking = await prisma.booking.create({
      data: {
        clientId: user.id,
        studioSessionId: session.id,
        status: BookingStatus.CONFIRMED,
        paymentSelection: "EXISTING_PLAN",
        selectedEntitlementId: entitlement.id,
        customerName: "E2E Prepared Client",
        customerEmail: parsed.data.clientEmail,
        customerPhone: "+32000000000",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
        consentAcceptedAt: new Date(),
      },
      select: { id: true },
    });

    await prisma.creditLedgerEntry.create({
      data: {
        clientId: user.id,
        entitlementId: entitlement.id,
        bookingId: booking.id,
        entryType: CreditLedgerEntryType.CONSUME,
        amount: -1,
        notes: "E2E prepared check-in booking consume.",
      },
    });

    return Response.json(
      { bookingId: booking.id, sessionId: session.id, sessionTitle: session.title },
      { status: 200 },
    );
  } catch (error) {
    console.error(
      "[e2e/prepare-checkin-window] unhandled error",
      error instanceof Error ? error.message : String(error),
    );
    return Response.json({ error: "Internal server error.", code: "INTERNAL_SERVER_ERROR" }, { status: 500 });
  }
}
