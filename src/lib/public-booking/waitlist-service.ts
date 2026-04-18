import {
  BookingIntent,
  BookingPaymentSelection,
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementScope,
  EntitlementType,
  Prisma,
  StudioSessionStatus,
  SubscriptionStatus,
  WaitlistStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { bookingDraftActiveBookingFilter } from "@/lib/public-booking/booking-draft-service";

type DbClient = Prisma.TransactionClient | typeof prisma;

type WaitlistErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_BOOKABLE"
  | "WAITLIST_NOT_SUPPORTED"
  | "SESSION_NOT_FULL"
  | "WAITLIST_FULL"
  | "ALREADY_BOOKED"
  | "ALREADY_WAITLISTED"
  | "WAITLIST_ENTRY_NOT_FOUND"
  | "WAITLIST_ENTRY_NOT_OWNED"
  | "WAITLIST_ENTRY_NOT_ACTIVE";

export class WaitlistServiceError extends Error {
  constructor(
    public readonly code: WaitlistErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type WaitlistPromotionNotification = {
  bookingId: string;
  clientEmail: string;
  clientName: string;
  location: string | null;
  sessionEndsAt: Date;
  sessionStartsAt: Date;
  sessionTitle: string;
  waitlistEntryId: string;
};

export type WaitlistJoinResult = {
  waitlistEntryId: string;
  joined: boolean;
};

type PromotionResult = {
  notifications: WaitlistPromotionNotification[];
};

function toEntitlementScopeFromCategorySlug(categorySlug: string): EntitlementScope {
  if (categorySlug.includes("private")) {
    return EntitlementScope.PRIVATE_CLASSES;
  }

  if (categorySlug.includes("workshop")) {
    return EntitlementScope.WORKSHOPS;
  }

  return EntitlementScope.COLLECTIVE_CLASSES;
}

function computeWaitlistLimit(capacity: number): number {
  return Math.max(0, Math.floor(capacity / 2));
}

function buildWaitlistCreditConsumeIdempotencyKey(input: {
  bookingId: string;
  clientId: string;
  entitlementId: string;
  waitlistEntryId: string;
}) {
  return [
    "waitlist-promotion",
    "consume",
    input.clientId,
    input.entitlementId,
    input.bookingId,
    input.waitlistEntryId,
  ].join(":");
}

async function createAuditLog(tx: DbClient, input: {
  actionType: string;
  actorId?: string | null;
  entityId?: string | null;
  entityType: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actionType: input.actionType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata,
    },
  });
}

async function getNextWaitlistPosition(tx: DbClient, studioSessionId: string): Promise<number> {
  const maxPosition = await tx.waitlistEntry.aggregate({
    where: {
      studioSessionId,
      status: WaitlistStatus.ACTIVE,
    },
    _max: {
      position: true,
    },
  });

  return (maxPosition._max.position ?? 0) + 1;
}

export type WaitlistPromotionCoverage = {
  eligible: boolean;
  consumeEntitlementId: string | null;
  selectedEntitlementId: string | null;
  reason:
    | "active_subscription_unlimited"
    | "active_unlimited_entitlement"
    | "credit_entitlement_available"
    | "no_eligible_entitlement"
    | "insufficient_credits";
};

export async function resolveWaitlistPromotionCoverage(tx: DbClient, input: {
  clientId: string;
  requiredScope: EntitlementScope;
}): Promise<WaitlistPromotionCoverage> {
  const now = new Date();

  const activeSubscription = await tx.subscriptionContract.findFirst({
    where: {
      clientId: input.clientId,
      status: SubscriptionStatus.ACTIVE,
      startsAt: { lte: now },
      currentPeriodStart: { lte: now },
      currentPeriodEnd: { gt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
      product: {
        entitlementRules: {
          some: {
            isActive: true,
            entitlementType: EntitlementType.UNLIMITED_ACCESS,
            entitlementScope: {
              in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
            },
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (activeSubscription) {
    return {
      eligible: true as const,
      consumeEntitlementId: null as string | null,
      selectedEntitlementId: null as string | null,
      reason: "active_subscription_unlimited",
    };
  }

  const unlimitedEntitlement = await tx.clientEntitlement.findFirst({
    where: {
      clientId: input.clientId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: EntitlementType.UNLIMITED_ACCESS,
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
    },
  });

  if (unlimitedEntitlement) {
    return {
      eligible: true as const,
      consumeEntitlementId: null as string | null,
      selectedEntitlementId: unlimitedEntitlement.id,
      reason: "active_unlimited_entitlement",
    };
  }

  const creditEntitlements = await tx.clientEntitlement.findMany({
    where: {
      clientId: input.clientId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
      entitlementScope: {
        in: [input.requiredScope, EntitlementScope.ALL_CLASSES],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  if (creditEntitlements.length < 1) {
    return {
      eligible: false as const,
      consumeEntitlementId: null,
      selectedEntitlementId: null,
      reason: "no_eligible_entitlement",
    };
  }

  const balances = await tx.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      clientId: input.clientId,
      entitlementId: {
        in: creditEntitlements.map((entitlement) => entitlement.id),
      },
    },
    _sum: {
      amount: true,
    },
  });
  const balanceByEntitlementId = new Map(
    balances
      .filter((balance): balance is typeof balance & { entitlementId: string } => Boolean(balance.entitlementId))
      .map((balance) => [balance.entitlementId, balance._sum.amount ?? 0]),
  );

  const withBalance = creditEntitlements
    .map((entitlement) => ({
      entitlementId: entitlement.id,
      createdAt: entitlement.createdAt,
      expiresAt: entitlement.expiresAt,
      balance: balanceByEntitlementId.get(entitlement.id) ?? 0,
    }))
    .filter((entitlement) => entitlement.balance > 0)
    .sort((a, b) => {
      const aExpiry = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      const bExpiry = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      if (aExpiry !== bExpiry) {
        return aExpiry - bExpiry;
      }

      const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }

      return a.entitlementId.localeCompare(b.entitlementId);
    });

  const selected = withBalance[0] ?? null;
  if (!selected) {
    return {
      eligible: false as const,
      consumeEntitlementId: null,
      selectedEntitlementId: null,
      reason: "insufficient_credits",
    };
  }

  return {
    eligible: true as const,
    consumeEntitlementId: selected.entitlementId,
    selectedEntitlementId: selected.entitlementId,
    reason: "credit_entitlement_available",
  };
}

async function processWaitlistPromotionsForSession(tx: DbClient, input: {
  actorUserId?: string | null;
  now: Date;
  studioSessionId: string;
  triggerSource: "DASHBOARD_BOOKING_CANCELLATION" | "SESSION_MANAGER_BOOKING_CANCELLATION";
}): Promise<PromotionResult> {
  const session = await tx.studioSession.findUnique({
    where: { id: input.studioSessionId },
    select: {
      id: true,
      title: true,
      location: true,
      startsAt: true,
      endsAt: true,
      capacity: true,
      status: true,
      isPublished: true,
      classType: {
        select: {
          category: {
            select: {
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    return { notifications: [] };
  }

  if (
    session.status !== StudioSessionStatus.SCHEDULED
    || !session.isPublished
    || session.startsAt <= input.now
  ) {
    return { notifications: [] };
  }

  const requiredScope = toEntitlementScopeFromCategorySlug(session.classType.category.slug);
  if (requiredScope !== EntitlementScope.COLLECTIVE_CLASSES) {
    return { notifications: [] };
  }

  let activeBookingCount = await tx.booking.count({
    where: {
      studioSessionId: session.id,
      ...bookingDraftActiveBookingFilter(input.now),
    },
  });

  if (activeBookingCount >= session.capacity) {
    return { notifications: [] };
  }

  const notifications: WaitlistPromotionNotification[] = [];

  while (activeBookingCount < session.capacity) {
    const candidate = await tx.waitlistEntry.findFirst({
      where: {
        studioSessionId: session.id,
        status: WaitlistStatus.ACTIVE,
      },
      orderBy: [{ position: "asc" }, { joinedAt: "asc" }],
      select: {
        id: true,
        clientId: true,
        position: true,
        client: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!candidate) {
      break;
    }

    const existingActiveBooking = await tx.booking.findFirst({
      where: {
        clientId: candidate.clientId,
        studioSessionId: session.id,
        status: {
          in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
        },
      },
      select: {
        id: true,
      },
    });

    if (existingActiveBooking) {
      await tx.waitlistEntry.update({
        where: { id: candidate.id },
        data: {
          status: WaitlistStatus.CANCELLED,
          promotedAt: null,
        },
      });

      await createAuditLog(tx, {
        actionType: "WAITLIST_REMOVED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: "existing_active_booking",
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      await createAuditLog(tx, {
        actionType: "WAITLIST_PROMOTION_SKIPPED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: "existing_active_booking",
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      continue;
    }

    const coverage = await resolveWaitlistPromotionCoverage(tx, {
      clientId: candidate.clientId,
      requiredScope,
    });

    if (!coverage.eligible) {
      await tx.waitlistEntry.update({
        where: { id: candidate.id },
        data: {
          status: WaitlistStatus.CANCELLED,
          promotedAt: null,
        },
      });

      await createAuditLog(tx, {
        actionType: "WAITLIST_REMOVED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: coverage.reason,
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      await createAuditLog(tx, {
        actionType: "WAITLIST_PROMOTION_SKIPPED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: coverage.reason,
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      continue;
    }

    const existingBooking = await tx.booking.findFirst({
      where: {
        clientId: candidate.clientId,
        studioSessionId: session.id,
      },
      select: {
        id: true,
        status: true,
      },
    });

    const promotedWaitlistEntry = await tx.waitlistEntry.updateMany({
      where: {
        id: candidate.id,
        status: WaitlistStatus.ACTIVE,
      },
      data: {
        status: WaitlistStatus.PROMOTED,
        promotedAt: input.now,
      },
    });
    if (promotedWaitlistEntry.count < 1) {
      continue;
    }

    let promotedBookingId: string;

    if (existingBooking && existingBooking.status !== BookingStatus.CANCELLED) {
      await tx.waitlistEntry.update({
        where: { id: candidate.id },
        data: {
          status: WaitlistStatus.CANCELLED,
          promotedAt: null,
        },
      });
      await createAuditLog(tx, {
        actionType: "WAITLIST_REMOVED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: "existing_non_cancellable_booking_record",
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      await createAuditLog(tx, {
        actionType: "WAITLIST_PROMOTION_SKIPPED",
        actorId: input.actorUserId,
        entityType: "WaitlistEntry",
        entityId: candidate.id,
        metadata: {
          reason: "existing_non_cancellable_booking_record",
          studioSessionId: session.id,
          clientId: candidate.clientId,
          triggerSource: input.triggerSource,
        },
      });
      continue;
    }

    if (existingBooking?.status === BookingStatus.CANCELLED) {
      const revivedBooking = await tx.booking.update({
        where: { id: existingBooking.id },
        data: {
          status: BookingStatus.CONFIRMED,
          bookingIntent: BookingIntent.USE_PLAN,
          paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
          selectedEntitlementId: coverage.selectedEntitlementId,
          selectedPriceId: null,
          draftAmountMinor: 0,
          draftCurrencyCode: "EUR",
          bookedAt: input.now,
          cancelledAt: null,
          cancelledById: null,
          cancellationReason: null,
          cancellationEligibleUntilAt: null,
          creditRefundedAt: null,
          customerName: candidate.client.name,
          customerEmail: candidate.client.email,
        },
        select: {
          id: true,
        },
      });
      promotedBookingId = revivedBooking.id;
    } else {
      const createdBooking = await tx.booking.create({
        data: {
          clientId: candidate.clientId,
          studioSessionId: session.id,
          status: BookingStatus.CONFIRMED,
          bookingIntent: BookingIntent.USE_PLAN,
          paymentSelection: BookingPaymentSelection.EXISTING_PLAN,
          selectedEntitlementId: coverage.selectedEntitlementId,
          selectedPriceId: null,
          draftAmountMinor: 0,
          draftCurrencyCode: "EUR",
          bookedAt: input.now,
          customerName: candidate.client.name,
          customerEmail: candidate.client.email,
        },
        select: {
          id: true,
        },
      });
      promotedBookingId = createdBooking.id;
    }

    if (coverage.consumeEntitlementId) {
      await tx.creditLedgerEntry.createMany({
        data: {
          clientId: candidate.clientId,
          entitlementId: coverage.consumeEntitlementId,
          bookingId: promotedBookingId,
          entryType: CreditLedgerEntryType.CONSUME,
          amount: -1,
          idempotencyKey: buildWaitlistCreditConsumeIdempotencyKey({
            bookingId: promotedBookingId,
            clientId: candidate.clientId,
            entitlementId: coverage.consumeEntitlementId,
            waitlistEntryId: candidate.id,
          }),
          notes: "Credit consumed after waitlist auto-promotion.",
        },
        skipDuplicates: true,
      });
    }

    await createAuditLog(tx, {
      actionType: "WAITLIST_PROMOTED",
      actorId: input.actorUserId,
      entityType: "WaitlistEntry",
      entityId: candidate.id,
      metadata: {
        studioSessionId: session.id,
        clientId: candidate.clientId,
        bookingId: promotedBookingId,
        consumedEntitlementId: coverage.consumeEntitlementId,
        selectedEntitlementId: coverage.selectedEntitlementId,
        promotionPosition: candidate.position,
        triggerSource: input.triggerSource,
      },
    });

    notifications.push({
      waitlistEntryId: candidate.id,
      bookingId: promotedBookingId,
      clientEmail: candidate.client.email,
      clientName: candidate.client.name,
      sessionTitle: session.title,
      sessionStartsAt: session.startsAt,
      sessionEndsAt: session.endsAt,
      location: session.location,
    });

    activeBookingCount += 1;
  }

  return { notifications };
}

export async function joinSessionWaitlist(input: {
  clientId: string;
  studioSessionId: string;
}): Promise<WaitlistJoinResult> {
  const now = new Date();

  return prisma.$transaction(
    async (tx) => {
      const session = await tx.studioSession.findUnique({
        where: { id: input.studioSessionId },
        select: {
          id: true,
          capacity: true,
          startsAt: true,
          status: true,
          isPublished: true,
          classType: {
            select: {
              category: {
                select: {
                  slug: true,
                },
              },
            },
          },
        },
      });

      if (!session) {
        throw new WaitlistServiceError("SESSION_NOT_FOUND", "Session not found.");
      }

      if (
        session.status !== StudioSessionStatus.SCHEDULED
        || !session.isPublished
        || session.startsAt <= now
      ) {
        throw new WaitlistServiceError("SESSION_NOT_BOOKABLE", "Session is not bookable.");
      }

      const requiredScope = toEntitlementScopeFromCategorySlug(session.classType.category.slug);
      if (requiredScope !== EntitlementScope.COLLECTIVE_CLASSES) {
        throw new WaitlistServiceError("WAITLIST_NOT_SUPPORTED", "Waitlist is only available for collective classes.");
      }

      const hasActiveBooking = await tx.booking.findFirst({
        where: {
          clientId: input.clientId,
          studioSessionId: session.id,
          status: {
            in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW],
          },
        },
        select: {
          id: true,
        },
      });
      if (hasActiveBooking) {
        throw new WaitlistServiceError("ALREADY_BOOKED", "You already have a booking for this session.");
      }

      const activeBookingCount = await tx.booking.count({
        where: {
          studioSessionId: session.id,
          ...bookingDraftActiveBookingFilter(now),
        },
      });
      if (activeBookingCount < session.capacity) {
        throw new WaitlistServiceError("SESSION_NOT_FULL", "Waitlist is available only when the session is full.");
      }

      const waitlistLimit = computeWaitlistLimit(session.capacity);
      const activeWaitlistCount = await tx.waitlistEntry.count({
        where: {
          studioSessionId: session.id,
          status: WaitlistStatus.ACTIVE,
        },
      });

      const existingEntry = await tx.waitlistEntry.findUnique({
        where: {
          clientId_studioSessionId: {
            clientId: input.clientId,
            studioSessionId: session.id,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (existingEntry?.status === WaitlistStatus.ACTIVE) {
        throw new WaitlistServiceError("ALREADY_WAITLISTED", "You are already on the waitlist for this session.");
      }

      if (activeWaitlistCount >= waitlistLimit) {
        throw new WaitlistServiceError("WAITLIST_FULL", "Waitlist is full for this session.");
      }

      const position = await getNextWaitlistPosition(tx, session.id);

      if (existingEntry?.status === WaitlistStatus.CANCELLED) {
        const reactivated = await tx.waitlistEntry.update({
          where: {
            id: existingEntry.id,
          },
          data: {
            status: WaitlistStatus.ACTIVE,
            promotedAt: null,
            joinedAt: now,
            position,
          },
          select: {
            id: true,
          },
        });

        await createAuditLog(tx, {
          actionType: "WAITLIST_JOIN",
          actorId: input.clientId,
          entityType: "WaitlistEntry",
          entityId: reactivated.id,
          metadata: {
            studioSessionId: session.id,
            clientId: input.clientId,
            position,
            reactivated: true,
          },
        });

        return {
          waitlistEntryId: reactivated.id,
          joined: false,
        };
      }

      const created = await tx.waitlistEntry.create({
        data: {
          clientId: input.clientId,
          studioSessionId: session.id,
          status: WaitlistStatus.ACTIVE,
          position,
          joinedAt: now,
        },
        select: {
          id: true,
        },
      });

      await createAuditLog(tx, {
        actionType: "WAITLIST_JOIN",
        actorId: input.clientId,
        entityType: "WaitlistEntry",
        entityId: created.id,
        metadata: {
          studioSessionId: session.id,
          clientId: input.clientId,
          position,
          reactivated: false,
        },
      });

      return {
        waitlistEntryId: created.id,
        joined: true,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function cancelSessionWaitlistEntry(input: {
  clientId: string;
  waitlistEntryId: string;
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const entry = await tx.waitlistEntry.findUnique({
        where: {
          id: input.waitlistEntryId,
        },
        select: {
          id: true,
          clientId: true,
          status: true,
          studioSessionId: true,
        },
      });

      if (!entry) {
        throw new WaitlistServiceError("WAITLIST_ENTRY_NOT_FOUND", "Waitlist entry not found.");
      }
      if (entry.clientId !== input.clientId) {
        throw new WaitlistServiceError("WAITLIST_ENTRY_NOT_OWNED", "Waitlist entry does not belong to this client.");
      }
      if (entry.status !== WaitlistStatus.ACTIVE) {
        throw new WaitlistServiceError("WAITLIST_ENTRY_NOT_ACTIVE", "Waitlist entry is not active.");
      }

      await tx.waitlistEntry.update({
        where: { id: entry.id },
        data: {
          status: WaitlistStatus.CANCELLED,
          promotedAt: null,
        },
      });

      await createAuditLog(tx, {
        actionType: "WAITLIST_CANCEL",
        actorId: input.clientId,
        entityType: "WaitlistEntry",
        entityId: entry.id,
        metadata: {
          studioSessionId: entry.studioSessionId,
          clientId: input.clientId,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

export async function promoteWaitlistAfterCancellationWithinTx(tx: DbClient, input: {
  actorUserId?: string | null;
  now: Date;
  studioSessionId: string;
  triggerSource: "DASHBOARD_BOOKING_CANCELLATION" | "SESSION_MANAGER_BOOKING_CANCELLATION";
}): Promise<PromotionResult> {
  return processWaitlistPromotionsForSession(tx, input);
}
