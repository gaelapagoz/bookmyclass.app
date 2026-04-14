import { BookingStatus, CreditLedgerEntryType, EntitlementType, StudioSessionStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertE2ETestRequest } from "@/lib/e2e/e2e-test-guard";

const payloadSchema = z.object({
  clientEmail: z.string().trim().email(),
  mode: z.enum(["late", "early"]),
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

  const user = await prisma.user.findFirst({
    where: {
      email: {
        equals: parsed.data.clientEmail,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });
  if (!user) {
    return Response.json({ error: "Client not found." }, { status: 404 });
  }

  const entitlement = await prisma.clientEntitlement.findFirst({
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
    return Response.json({ error: "Active entitlement not found." }, { status: 404 });
  }

  const referenceSession = await prisma.studioSession.findFirst({
    where: { status: StudioSessionStatus.SCHEDULED, isPublished: true },
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

  const now = new Date();
  const startsAt = new Date(now.getTime() + (parsed.data.mode === "late" ? 2 : 50) * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

  const session = await prisma.studioSession.create({
    data: {
      classTypeId: referenceSession.classTypeId,
      classTemplateId: referenceSession.classTemplateId,
      teacherId: referenceSession.teacherId,
      title: `E2E ${parsed.data.mode} cancellation window`,
      startsAt,
      endsAt,
      capacity: 20,
      status: StudioSessionStatus.SCHEDULED,
      isPublished: true,
    },
    select: { id: true },
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
      notes: "E2E prepared cancellation booking consume.",
    },
  });

  return Response.json({ bookingId: booking.id, mode: parsed.data.mode }, { status: 200 });
}
