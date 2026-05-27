import {
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
  CreditLedgerEntryType,
  Prisma,
  Role,
  StudioSessionStatus,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import { resolveEntitlementScope } from "@/lib/booking/entitlement-scope";
import { consumeCredit } from "@/lib/credits/credit-service";
import {
  bookingDraftActiveBookingFilter,
  countActiveBookingsForSession,
  expireStaleBookingDraftsForSessionWithinTx,
} from "@/lib/public-booking/booking-draft-service";
import { enqueueWaitlistPromotionNotification } from "@/lib/public-booking/waitlist-notification-service";
import { ensureBookingConfirmationEventForConfirmedBooking } from "@/lib/public-booking/booking-confirmation-transition-service";
import { promoteWaitlistAfterCancellationWithinTx, resolveWaitlistPromotionCoverage } from "@/lib/public-booking/waitlist-service";

export type AdminBookingStatusFilter =
  | "all"
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "noShow";

export type AdminBookingItem = {
  id: string;
  status: BookingStatus;
  paymentSelection: string | null;
  bookedAt: string;
  customerName: string;
  customerEmail: string;
  sessionTitle: string;
  startsAt: string;
};

export type AdminBookingsPageData = {
  data: AdminBookingItem[];
  totalPages: number;
};

type SessionManagerActor = {
  userId: string;
  role: Role;
};

const MANUAL_OVERRIDE_AUDIT_ACTION = "BOOKING_ADMIN_OVERRIDE_CREATE";

function getAdminBookingStatus(filter: AdminBookingStatusFilter): BookingStatus | null {
  switch (filter) {
    case "confirmed":
      return BookingStatus.CONFIRMED;
    case "completed":
      return BookingStatus.COMPLETED;
    case "cancelled":
      return BookingStatus.CANCELLED;
    case "noShow":
      return BookingStatus.NO_SHOW;
    default:
      return null;
  }
}

export async function getBookings(input: {
  page: number;
  pageSize?: number;
  filter?: AdminBookingStatusFilter;
  query?: string;
}): Promise<AdminBookingsPageData> {
  const pageSize = Math.max(1, Math.min(input.pageSize ?? 20, 100));
  const page = Math.max(1, Math.floor(input.page));
  const query = input.query?.trim() ?? "";
  const skip = (page - 1) * pageSize;
  const status = getAdminBookingStatus(input.filter ?? "all");

  const where: Prisma.BookingWhereInput = {
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { customerName: { contains: query, mode: "insensitive" } },
            { customerEmail: { contains: query, mode: "insensitive" } },
            { client: { name: { contains: query, mode: "insensitive" } } },
            { client: { email: { contains: query, mode: "insensitive" } } },
            { studioSession: { title: { contains: query, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [totalItems, bookings] = await prisma.$transaction([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      orderBy: [{ bookedAt: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        status: true,
        paymentSelection: true,
        bookedAt: true,
        customerName: true,
        customerEmail: true,
        client: { select: { name: true, email: true } },
        studioSession: { select: { title: true, startsAt: true } },
      },
    }),
  ]);

  return {
    data: bookings.map((item) => ({
      id: item.id,
      status: item.status,
      paymentSelection: item.paymentSelection,
      bookedAt: item.bookedAt.toISOString(),
      customerName: item.customerName ?? item.client?.name ?? "Guest",
      customerEmail: item.customerEmail ?? item.client?.email ?? "-",
      sessionTitle: item.studioSession.title,
      startsAt: item.studioSession.startsAt.toISOString(),
    })),
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

export async function getAdminBookingsData(): Promise<AdminBookingItem[]> {
  const page = await getBookings({ page: 1, pageSize: 100 });
  return page.data;
}

export async function addSessionAttendeeByManager(input: {
  studioSessionId: string;
  clientId: string;
  note?: string;
  overrideReason?: string;
  actor: SessionManagerActor;
}) {
  const normalizedNote = input.note?.trim() ?? "";
  const normalizedOverrideReason = input.overrideReason?.trim() ?? "";
  const now = new Date();

  const [actorUser, clientUser, session] = await prisma.$transaction([
    prisma.user.findUnique({ where: { id: input.actor.userId }, select: { id: true, role: true } }),
    prisma.user.findUnique({ where: { id: input.clientId }, select: { id: true, role: true, email: true, name: true } }),
    prisma.studioSession.findUnique({
      where: { id: input.studioSessionId },
      select: {
        id: true,
        teacherId: true,
        title: true,
        startsAt: true,
        capacity: true,
        status: true,
        classType: { select: { serviceScope: true, category: { select: { slug: true } } } },
      },
    }),
  ]);

  if (!actorUser || (actorUser.role !== Role.ADMIN && actorUser.role !== Role.MASTER_ADMIN && actorUser.role !== Role.TEACHER)) throw new Error("SESSION_MANAGER_FORBIDDEN");
  if (!clientUser || clientUser.role !== Role.CLIENT) throw new Error("CLIENT_NOT_FOUND");
  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (actorUser.role === Role.TEACHER && session.teacherId !== actorUser.id) throw new Error("TEACHER_SESSION_FORBIDDEN");
  if (session.status !== StudioSessionStatus.SCHEDULED || session.startsAt <= now) throw new Error("SESSION_NOT_BOOKABLE");

  const requiredScope = resolveEntitlementScope({ serviceScope: session.classType.serviceScope, categorySlug: session.classType.category.slug });

  const MAX_ATTENDEE_ADD_RETRIES = 4;
  let attendeeAddAttempt = 0;
  while (true) {
    try {
      return await prisma.$transaction(async (tx) => {
        await expireStaleBookingDraftsForSessionWithinTx({ prismaClient: tx, studioSessionId: session.id, now });

        const existingActiveBooking = await tx.booking.findFirst({
          where: { studioSessionId: session.id, clientId: clientUser.id, ...bookingDraftActiveBookingFilter(now) },
          select: { id: true, status: true, selectedEntitlementId: true },
        });

        if (existingActiveBooking) {
          return {
            bookingId: existingActiveBooking.id,
            status: existingActiveBooking.status,
            usedCreditEntitlementId: existingActiveBooking.selectedEntitlementId,
            overrideApplied: false,
          };
        }

        const activeBookingCount = await countActiveBookingsForSession({ studioSessionId: session.id, now, prismaClient: tx });
        if (activeBookingCount >= session.capacity) throw new Error("SESSION_FULL");

        const coverage = await resolveWaitlistPromotionCoverage(tx, { clientId: clientUser.id, requiredScope });
        const canOverrideWithoutEligibility = actorUser.role === Role.ADMIN || actorUser.role === Role.MASTER_ADMIN;
        const shouldApplyOverride = !coverage.eligible && canOverrideWithoutEligibility;

        if (!coverage.eligible && actorUser.role === Role.TEACHER) throw new Error("SESSION_ELIGIBILITY_REQUIRED");
        if (shouldApplyOverride && normalizedOverrideReason.length < 10) throw new Error("SESSION_OVERRIDE_REASON_REQUIRED");
        if (!coverage.eligible && !shouldApplyOverride) throw new Error("SESSION_ELIGIBILITY_REQUIRED");

        const createdBooking = await tx.booking.create({
          data: {
            clientId: clientUser.id,
            studioSessionId: session.id,
            status: BookingStatus.CONFIRMED,
            bookingIntent: shouldApplyOverride ? BookingIntent.SINGLE_BOOKING : BookingIntent.USE_ENTITLEMENT,
            paymentSelection: shouldApplyOverride ? null : BookingPaymentSelection.EXISTING_PLAN,
            selectedEntitlementId: shouldApplyOverride ? null : coverage.selectedEntitlementId,
            draftAmountMinor: 0,
            draftCurrencyCode: "EUR",
            bookedAt: now,
            customerName: clientUser.name,
            customerEmail: clientUser.email,
          },
          select: { id: true, status: true },
        });

        if (!shouldApplyOverride && coverage.consumeEntitlementId) {
          await consumeCredit({
            clientId: clientUser.id,
            entitlementId: coverage.consumeEntitlementId,
            bookingId: createdBooking.id,
            reason: `admin:attendee-add${normalizedNote ? `:${normalizedNote}` : ""}`,
            idempotencyKey: `admin-attendee-add:${clientUser.id}:${coverage.consumeEntitlementId}:${createdBooking.id}`,
            createdById: actorUser.id,
            prismaClient: tx,
          });
        }

        if (shouldApplyOverride) {
          await tx.auditLog.create({
            data: {
              actorId: actorUser.id,
              actionType: MANUAL_OVERRIDE_AUDIT_ACTION,
              entityType: "Booking",
              entityId: createdBooking.id,
              metadata: {
                action: MANUAL_OVERRIDE_AUDIT_ACTION,
                entityType: "Booking",
                entityId: createdBooking.id,
                actorUserId: actorUser.id,
                actorRole: actorUser.role,
                targetClientId: clientUser.id,
                studioSessionId: session.id,
                overrideType: "NO_CREDIT_MANUAL_BOOKING",
                overrideReason: normalizedOverrideReason,
                entitlementBypassed: true,
                creditLedgerEntryCreated: false,
                paymentCreated: false,
                revenueCreated: false,
                capacityConsumed: true,
                bookingStatus: BookingStatus.CONFIRMED,
                note: normalizedNote || null,
              },
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorId: actorUser.id,
            actionType: "SESSION_ATTENDEE_ADD",
            entityType: "Booking",
            entityId: createdBooking.id,
            metadata: {
              sessionId: session.id,
              clientId: clientUser.id,
              usedCreditEntitlementId: shouldApplyOverride ? null : coverage.consumeEntitlementId,
              selectedEntitlementId: shouldApplyOverride ? null : coverage.selectedEntitlementId,
              coverageReason: shouldApplyOverride ? "admin_override_no_credit" : coverage.reason,
              overrideApplied: shouldApplyOverride,
              note: normalizedNote || null,
            },
          },
        });

        return {
          bookingId: createdBooking.id,
          status: createdBooking.status,
          usedCreditEntitlementId: shouldApplyOverride ? null : coverage.consumeEntitlementId,
          overrideApplied: shouldApplyOverride,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (attendeeAddAttempt < MAX_ATTENDEE_ADD_RETRIES && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        const baseMs = 20 * 2 ** (attendeeAddAttempt + 1);
        await new Promise((resolve) => setTimeout(resolve, Math.min(200, baseMs + Math.floor(Math.random() * 20))));
        attendeeAddAttempt++;
        continue;
      }
      throw error;
    }
  }
}

export async function removeSessionAttendeeByManager(input: {
  studioSessionId: string;
  bookingId: string;
  note?: string;
  actor: SessionManagerActor;
}) {
  const normalizedNote = input.note?.trim() ?? "";
  const now = new Date();

  const actorUser = await prisma.user.findUnique({ where: { id: input.actor.userId }, select: { id: true, role: true } });
  if (!actorUser || (actorUser.role !== Role.ADMIN && actorUser.role !== Role.MASTER_ADMIN && actorUser.role !== Role.TEACHER)) {
    throw new Error("SESSION_MANAGER_FORBIDDEN");
  }

  const [session, booking] = await prisma.$transaction([
    prisma.studioSession.findUnique({ where: { id: input.studioSessionId }, select: { id: true, teacherId: true } }),
    prisma.booking.findFirst({
      where: { id: input.bookingId, studioSessionId: input.studioSessionId },
      select: { id: true, clientId: true, status: true, selectedEntitlementId: true, creditRefundedAt: true },
    }),
  ]);

  if (!session) throw new Error("SESSION_NOT_FOUND");
  if (actorUser.role === Role.TEACHER && session.teacherId !== actorUser.id) throw new Error("TEACHER_SESSION_FORBIDDEN");
  if (!booking) throw new Error("SESSION_ATTENDEE_NOT_FOUND");

  if (booking.status === BookingStatus.CANCELLED) {
    return { bookingId: booking.id, restoredCredit: false, alreadyCancelled: true };
  }

  if (!booking.clientId) throw new Error("CLIENT_NOT_FOUND");
  const bookingClientId = booking.clientId;

  const promotionResult = await prisma.$transaction(async (tx) => {
    let restoredCredit = false;

    if (booking.selectedEntitlementId && !booking.creditRefundedAt) {
      const consumed = await tx.creditLedgerEntry.findFirst({
        where: {
          bookingId: booking.id,
          entitlementId: booking.selectedEntitlementId,
          entryType: CreditLedgerEntryType.CONSUME,
        },
        select: { id: true },
      });

      const restoreExists = await tx.creditLedgerEntry.findFirst({
        where: {
          bookingId: booking.id,
          entitlementId: booking.selectedEntitlementId,
          entryType: CreditLedgerEntryType.RESTORE,
        },
        select: { id: true },
      });

      if (consumed && !restoreExists) {
        await tx.creditLedgerEntry.create({
          data: {
            clientId: bookingClientId,
            entitlementId: booking.selectedEntitlementId,
            bookingId: booking.id,
            entryType: CreditLedgerEntryType.RESTORE,
            amount: 1,
            createdById: actorUser.id,
            happenedAt: now,
            notes: `Credit restored from session attendee removal${normalizedNote ? `: ${normalizedNote}` : "."}`,
          },
        });
        restoredCredit = true;
      }
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: now,
        cancelledById: actorUser.id,
        cancellationReason: normalizedNote || "Cancelled by session manager from session edit page.",
        creditRefundedAt: restoredCredit ? now : booking.creditRefundedAt,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: actorUser.id,
        actionType: "SESSION_ATTENDEE_REMOVE",
        entityType: "Booking",
        entityId: booking.id,
        metadata: {
          sessionId: input.studioSessionId,
          clientId: bookingClientId,
          restoredCredit,
          note: normalizedNote || null,
        },
      },
    });

    const promotion = await promoteWaitlistAfterCancellationWithinTx(tx, {
      actorUserId: actorUser.id,
      now,
      studioSessionId: input.studioSessionId,
      triggerSource: "SESSION_MANAGER_BOOKING_CANCELLATION",
    });

    return {
      bookingId: booking.id,
      restoredCredit,
      alreadyCancelled: false,
      waitlistNotifications: promotion.notifications,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  await Promise.all(
    promotionResult.waitlistNotifications.map(async (promotion) => {
      try {
        await Promise.all([
          enqueueWaitlistPromotionNotification(promotion),
          ensureBookingConfirmationEventForConfirmedBooking({ bookingId: promotion.bookingId }),
        ]);
      } catch (error) {
        try {
          await prisma.auditLog.create({
            data: {
              actorId: actorUser.id,
              actionType: "WAITLIST_PROMOTION_EMAIL_ENQUEUE_FAILED",
              entityType: "WaitlistEntry",
              entityId: promotion.waitlistEntryId,
              metadata: {
                bookingId: promotion.bookingId,
                clientEmail: promotion.clientEmail,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            },
          });
        } catch {
          // Keep behavior: swallow logging failure and continue.
        }
      }
    }),
  );

  return {
    bookingId: promotionResult.bookingId,
    restoredCredit: promotionResult.restoredCredit,
    alreadyCancelled: promotionResult.alreadyCancelled,
  };
}
