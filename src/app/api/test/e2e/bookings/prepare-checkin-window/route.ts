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
      product = await prisma.product.create({
        data: {
          name: `E2E check-in pack ${Date.now()}`,
          slug: `e2e-checkin-pack-${Date.now()}`,
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

  const referenceSession = await prisma.studioSession.findFirst({
    where: {
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
      teacher: {
        email: {
          equals: "teacher.e2e@bookmyclass.local",
          mode: "insensitive",
        },
      },
    },
    orderBy: { startsAt: "asc" },
    select: {
      classTypeId: true,
      classTemplateId: true,
      teacherId: true,
    },
  });
  if (!referenceSession?.classTypeId || !referenceSession.classTemplateId || !referenceSession.teacherId) {
    return Response.json({ error: "Reference session data missing." }, { status: 404 });
  }

  let classTypeId = referenceSession.classTypeId;
  let classTemplateId = referenceSession.classTemplateId;
  let teacherId = referenceSession.teacherId;

  if (classMode === "private") {
    const privateReferenceSession = await prisma.studioSession.findFirst({
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
        classTemplateId: true,
        teacherId: true,
      },
    });

    if (privateReferenceSession?.classTypeId && privateReferenceSession.classTemplateId && privateReferenceSession.teacherId) {
      classTypeId = privateReferenceSession.classTypeId;
      classTemplateId = privateReferenceSession.classTemplateId;
      teacherId = privateReferenceSession.teacherId;
    } else {
      const fallbackTeacher = await prisma.user.findFirst({
        where: {
          role: {
            in: [Role.TEACHER, Role.ADMIN, Role.MASTER_ADMIN],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });

      if (!fallbackTeacher?.id) {
        return Response.json({ error: "Staff user missing for private fixture setup." }, { status: 404 });
      }

      const privateCategory = await prisma.classCategory.upsert({
        where: { slug: "e2e-private-category" },
        update: {
          name: "E2E Private Category",
          isActive: true,
        },
        create: {
          name: "E2E Private Category",
          slug: "e2e-private-category",
          sortOrder: 9990,
          isActive: true,
        },
        select: { id: true },
      });

      const privateClassType = await prisma.classType.upsert({
        where: { slug: "e2e-private-checkin-class" },
        update: {
          categoryId: privateCategory.id,
          name: "E2E Private Check-in Class",
          isActive: true,
          isVisible: true,
        },
        create: {
          categoryId: privateCategory.id,
          name: "E2E Private Check-in Class",
          slug: "e2e-private-checkin-class",
          description: "E2E private kiosk exclusion fixture",
          defaultDurationMinutes: 60,
          defaultCapacity: 10,
          isActive: true,
          isVisible: true,
          sortOrder: 9990,
        },
        select: { id: true },
      });

      const privateTemplate = await prisma.classTemplate.upsert({
        where: { slug: "e2e-private-checkin-template" },
        update: {
          classTypeId: privateClassType.id,
          defaultTeacherId: fallbackTeacher.id,
          title: "E2E Private Check-in Template",
          defaultCapacity: 10,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
        create: {
          classTypeId: privateClassType.id,
          defaultTeacherId: fallbackTeacher.id,
          title: "E2E Private Check-in Template",
          slug: "e2e-private-checkin-template",
          defaultCapacity: 10,
          defaultDurationMinutes: 60,
          isActive: true,
          isPublished: true,
        },
        select: { id: true },
      });

      classTypeId = privateClassType.id;
      classTemplateId = privateTemplate.id;
      teacherId = fallbackTeacher.id;
    }
  }

  const now = new Date();
  const startsAt = mode === "before_window"
    ? new Date(now.getTime() + 45 * 60 * 1000)
    : mode === "after_window"
      ? new Date(now.getTime() - 30 * 60 * 1000)
      : new Date(now.getTime() + 5 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const sessionTitle = `E2E check-in ${classMode} ${mode} ${Date.now()}`;

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
}
