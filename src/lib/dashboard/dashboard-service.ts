import {
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementType,
  GiftCardCodeStatus,
  OrderStatus,
  Prisma,
  ProductType,
  SubscriptionStatus,
  StudioSessionStatus,
  WaitlistStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { STORE_PICKUP_WORDING } from "@/lib/store/store-constants";
import { requestEmailChange, UserIdentityError } from "@/lib/auth/user-identity-service";
import { sendWaitlistPromotionNotification } from "@/lib/public-booking/waitlist-notification-service";
import {
  cancelSessionWaitlistEntry,
  promoteWaitlistAfterCancellationWithinTx,
  WaitlistServiceError,
} from "@/lib/public-booking/waitlist-service";
import {
  getLatestStripeCustomerIdForUser,
  getOwnedOneTimeProducts,
  getOwnedRecurringSubscriptions,
  type OwnedOneTimeProduct,
  type OwnedRecurringSubscription,
} from "@/lib/subscription/ownership";
import {
  evaluateBookingCancellation,
  normalizeBookingCancellationWindowHours,
} from "@/lib/booking/cancellation-policy";
import { assertBookingNotCheckedInForCancellation, getBookingSelfCheckInEligibility } from "@/lib/attendance/attendance-service";
import { restoreCredit } from "@/lib/credits/credit-service";
import { STORE_PRODUCT_TYPES } from "@/lib/catalog/product-scopes";
import type { MediaAssetReadModel } from "@/lib/media/product-media-service";
import { getCanonicalMediaRenderState } from "@/lib/media";

type DashboardServiceErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_OWNED"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_TOO_LATE_TO_CANCEL"
  | "BOOKING_ALREADY_CHECKED_IN"
  | "WAITLIST_ENTRY_NOT_FOUND"
  | "WAITLIST_ENTRY_NOT_OWNED"
  | "WAITLIST_ENTRY_NOT_ACTIVE"
  | "EMAIL_ALREADY_IN_USE"
  | "INVALID_PROFILE_INPUT"
  | "EMAIL_CHANGE_REQUIRES_PASSWORD"
  | "INVALID_CURRENT_PASSWORD";

export class DashboardServiceError extends Error {
  constructor(
    public readonly code: DashboardServiceErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isVisibleHistoricalBookingStatus(status: BookingStatus): boolean {
  return status !== BookingStatus.CANCELLED && status !== BookingStatus.EXPIRED;
}

export type DashboardBookingItem = {
  bookingId: string;
  status: BookingStatus;
  serviceTitle: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  cancellationEligibleUntilAt: string | null;
  canCancel: boolean;
  cancellationBlockedReason: string | null;
  canCheckIn: boolean;
  checkInBlockedReason: string | null;
  isCheckedIn: boolean;
};

export type DashboardHomeData = {
  userName: string;
  nextUpcomingBooking: DashboardBookingItem | null;
  activeSubscription: {
    productName: string;
    currentPeriodEnd: string;
  } | null;
  creditsLeft: number;
  recentBookings: DashboardBookingItem[];
};

export type DashboardWaitlistItem = {
  waitlistEntryId: string;
  serviceTitle: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  joinedAt: string;
};

export type DashboardProfileData = {
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
};

export type DashboardBookingsData = {
  upcoming: DashboardBookingItem[];
  past: DashboardBookingItem[];
  cancelled: DashboardBookingItem[];
  waitlist: DashboardWaitlistItem[];
};

export type DashboardMembershipData = {
  activeSubscription: {
    productName: string;
    status: SubscriptionStatus;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  } | null;
  currentPlans: Array<{
    planId: string;
    source: "SUBSCRIPTION" | "ENTITLEMENT";
    productName: string;
    planType: EntitlementType | "SUBSCRIPTION";
    status: SubscriptionStatus | ClientEntitlementStatus;
    expiresAt: string | null;
    remainingCredits: number | null;
  }>;
  activeCreditPacks: Array<{
    entitlementId: string;
    productName: string;
    status: ClientEntitlementStatus;
    expiresAt: string | null;
    remainingCredits: number;
    nextToConsume: boolean;
  }>;
  ownedOneTimeProducts: OwnedOneTimeProduct[];
  recurringSubscriptions: OwnedRecurringSubscription[];
  canManageStripeBilling: boolean;
  usableCredits: number;
  creditsLeft: number;
};

function buildBookingCreditLedgerIdempotencyKey(input: {
  type: "RESTORE";
  clientId: string;
  entitlementId: string;
  bookingId: string;
}): string {
  return ["dashboard-booking", input.type, input.clientId, input.entitlementId, input.bookingId].join(":");
}

function isRetryableSerializationError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    && error.code === "P2034"
  ) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("write conflict")
    || message.includes("deadlock")
    || message.includes("could not serialize access")
  );
}

function getRetryDelayMs(attempt: number): number {
  const baseDelayMs = 20 * 2 ** attempt;
  const jitterMs = Math.floor(Math.random() * 20);
  return Math.min(200, baseDelayMs + jitterMs);
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function toBookingItem(input: {
  booking: {
    id: string;
    status: BookingStatus;
    studioSession: {
      title: string;
      startsAt: Date;
      endsAt: Date;
      location: string | null;
      status: StudioSessionStatus;
    };
  };
  clientId: string;
  now: Date;
  cancellationCutoffHours: number;
}): Promise<DashboardBookingItem> {
  const { booking, clientId, now, cancellationCutoffHours } = input;
  const session = booking.studioSession;
  const cancellation = evaluateBookingCancellation({
    bookingStatus: booking.status,
    sessionStatus: session.status,
    sessionStartsAt: session.startsAt,
    now,
    cancellationWindowHours: cancellationCutoffHours,
  });

  const checkInEligibility = await getBookingSelfCheckInEligibility(booking.id, clientId);

  return {
    bookingId: booking.id,
    status: booking.status,
    serviceTitle: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    location: session.location,
    cancellationEligibleUntilAt: cancellation.cancellationEligibleUntilAt.toISOString(),
    canCancel: cancellation.canCancel,
    cancellationBlockedReason: cancellation.cancellationBlockedReason,
    canCheckIn: checkInEligibility.isConfirmedBooking && checkInEligibility.isSessionScheduled && !checkInEligibility.isPrivateClass && checkInEligibility.isWithinWindow && checkInEligibility.attendanceStatus !== "CHECKED_IN",
    checkInBlockedReason: checkInEligibility.isPrivateClass ? "Private classes not eligible for self check-in" : checkInEligibility.attendanceStatus === "CHECKED_IN" ? "Already checked in" : !checkInEligibility.isConfirmedBooking ? "Booking not confirmed" : !checkInEligibility.isSessionScheduled ? "Session not scheduled" : !checkInEligibility.isWithinWindow ? "Outside check-in window" : null,
    isCheckedIn: checkInEligibility.attendanceStatus === "CHECKED_IN",
  };
}

async function getCancellationCutoffHours(): Promise<number> {
  const existing = await prisma.bookingPolicy.findFirst({
    where: { scope: "GLOBAL" },
    select: { cancellationCutoffHours: true },
  });
  if (existing) return normalizeBookingCancellationWindowHours(existing.cancellationCutoffHours);

  try {
    const created = await prisma.bookingPolicy.create({
      data: { scope: "GLOBAL", cancellationCutoffHours: 24 },
      select: { cancellationCutoffHours: true },
    });
    return normalizeBookingCancellationWindowHours(created.cancellationCutoffHours);
  } catch {
    // Race: another concurrent request created it — read it back.
    const fallback = await prisma.bookingPolicy.findFirst({
      where: { scope: "GLOBAL" },
      select: { cancellationCutoffHours: true },
    });
    return normalizeBookingCancellationWindowHours(fallback?.cancellationCutoffHours ?? 24);
  }
}

export async function getCreditsLeft(clientId: string): Promise<number> {
  const result = await prisma.creditLedgerEntry.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

async function getUsableCreditsForActivePacks(clientId: string, now: Date): Promise<number> {
  const entitlements = await prisma.clientEntitlement.findMany({
    where: {
      clientId,
      status: ClientEntitlementStatus.ACTIVE,
      entitlementType: {
        in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });

  if (entitlements.length === 0) {
    return 0;
  }

  const balances = await prisma.creditLedgerEntry.groupBy({
    by: ["entitlementId"],
    where: {
      clientId,
      entitlementId: { in: entitlements.map((entitlement) => entitlement.id) },
    },
    _sum: { amount: true },
  });

  return balances.reduce((sum, row) => sum + Math.max(row._sum.amount ?? 0, 0), 0);
}

export async function getDashboardHomeData(clientId: string): Promise<DashboardHomeData> {
  const now = new Date();
  const cancellationCutoffHours = await getCancellationCutoffHours();
  const [user, activeSubscription, upcoming, recent, usableCredits] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: clientId },
      select: {
        name: true,
        firstName: true,
        lastName: true,
      },
    }),
    prisma.subscriptionContract.findFirst({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: now },
      },
      orderBy: { currentPeriodEnd: "asc" },
      select: {
        currentPeriodEnd: true,
        product: { select: { name: true } },
      },
    }),
    prisma.booking.findFirst({
      where: {
        clientId,
        status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
        studioSession: {
          startsAt: { gt: now },
          status: StudioSessionStatus.SCHEDULED,
        },
      },
      orderBy: { studioSession: { startsAt: "asc" } },
      select: {
        id: true,
        status: true,
        studioSession: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            location: true,
            status: true,
          },
        },
      },
    }),
    prisma.booking.findMany({
      where: { clientId },
      orderBy: { bookedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        studioSession: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            location: true,
            status: true,
          },
        },
      },
    }),
    getUsableCreditsForActivePacks(clientId, now),
  ]);

  return {
    userName: user.firstName?.trim() || user.name,
    nextUpcomingBooking: upcoming
      ? await toBookingItem({ booking: upcoming, clientId, now, cancellationCutoffHours })
      : null,
    activeSubscription: activeSubscription
      ? {
          productName: activeSubscription.product.name,
          currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
        }
      : null,
    creditsLeft: usableCredits,
    recentBookings: await Promise.all(recent.map((booking) =>
      toBookingItem({ booking, clientId, now, cancellationCutoffHours }),
    )),
  };
}

export async function getDashboardProfileData(clientId: string): Promise<DashboardProfileData> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: clientId },
    select: {
      name: true,
      firstName: true,
      lastName: true,
      email: true,
      clientProfile: { select: { phone: true } },
    },
  });

  return {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    fullName: user.name,
    email: user.email,
    phone: user.clientProfile?.phone ?? "",
  };
}

export async function updateDashboardProfile(
  clientId: string,
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    currentPasswordForEmailChange?: string;
    appUrl?: string;
  },
): Promise<{ emailChangeRequested: boolean }> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const name = `${firstName} ${lastName}`.trim();

  if (!firstName || !lastName || !email) {
    throw new DashboardServiceError("INVALID_PROFILE_INPUT", "Invalid profile input.");
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: clientId },
    select: { email: true },
  });

  if (!currentUser) {
    throw new DashboardServiceError("INVALID_PROFILE_INPUT", "Invalid profile input.");
  }

  try {
    await prisma.user.update({
      where: { id: clientId },
      data: {
        firstName,
        lastName,
        name,
        clientProfile: {
          upsert: {
            update: { phone: phone || null },
            create: { phone: phone || null },
          },
        },
      },
    });

    const currentEmail = currentUser.email.trim().toLowerCase();
    if (email !== currentEmail) {
      const currentPasswordForEmailChange = input.currentPasswordForEmailChange?.trim() ?? "";
      if (!currentPasswordForEmailChange) {
        throw new DashboardServiceError(
          "EMAIL_CHANGE_REQUIRES_PASSWORD",
          "Current password is required to change email.",
        );
      }

      const result = await requestEmailChange({
        userId: clientId,
        newEmail: email,
        currentPassword: currentPasswordForEmailChange,
        appUrl: input.appUrl,
      });

      if (result.outcome === "RATE_LIMITED") {
        throw new DashboardServiceError(
          "INVALID_PROFILE_INPUT",
          "Please wait before requesting another email change.",
        );
      }

      return { emailChangeRequested: result.outcome === "SENT" };
    }

    return { emailChangeRequested: false };
  } catch (error) {
    if (error instanceof DashboardServiceError) {
      throw error;
    }

    if (error instanceof UserIdentityError) {
      if (error.code === "EMAIL_ALREADY_IN_USE") {
        throw new DashboardServiceError(
          "EMAIL_ALREADY_IN_USE",
          "That email address is already in use.",
        );
      }

      if (error.code === "INVALID_CURRENT_PASSWORD") {
        throw new DashboardServiceError(
          "INVALID_CURRENT_PASSWORD",
          "Current password is incorrect.",
        );
      }

      if (error.code === "EMAIL_CHANGE_REQUIRES_PASSWORD") {
        throw new DashboardServiceError(
          "EMAIL_CHANGE_REQUIRES_PASSWORD",
          "Current password is required to change email.",
        );
      }
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DashboardServiceError(
        "EMAIL_ALREADY_IN_USE",
        "That email address is already in use.",
      );
    }

    throw error;
  }
}

export async function getDashboardBookingsData(clientId: string): Promise<DashboardBookingsData> {
  const now = new Date();
  const cancellationCutoffHours = await getCancellationCutoffHours();
  const [bookings, waitlistEntries] = await Promise.all([
    prisma.booking.findMany({
      where: { clientId },
      orderBy: [{ studioSession: { startsAt: "desc" } }, { bookedAt: "desc" }],
      select: {
        id: true,
        status: true,
        studioSession: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            location: true,
            status: true,
          },
        },
      },
    }),
    prisma.waitlistEntry.findMany({
      where: {
        clientId,
        status: WaitlistStatus.ACTIVE,
        studioSession: {
          startsAt: { gt: now },
          status: StudioSessionStatus.SCHEDULED,
          isPublished: true,
        },
      },
      orderBy: [{ studioSession: { startsAt: "asc" } }, { joinedAt: "asc" }],
      select: {
        id: true,
        joinedAt: true,
        studioSession: {
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            location: true,
          },
        },
      },
    }),
  ]);

  const mapped = await Promise.all(bookings.map((booking) =>
    toBookingItem({ booking, clientId, now, cancellationCutoffHours }),
  ));
  const upcoming = mapped.filter(
    (booking) =>
      isVisibleHistoricalBookingStatus(booking.status) &&
      new Date(booking.startsAt) > now,
  );
  const cancelled = mapped.filter((booking) => booking.status === BookingStatus.CANCELLED);
  const past = mapped.filter(
    (booking) =>
      isVisibleHistoricalBookingStatus(booking.status) &&
      new Date(booking.startsAt) <= now,
  );

  const waitlist = waitlistEntries.map((entry) => ({
    waitlistEntryId: entry.id,
    serviceTitle: entry.studioSession.title,
    startsAt: entry.studioSession.startsAt.toISOString(),
    endsAt: entry.studioSession.endsAt.toISOString(),
    location: entry.studioSession.location,
    joinedAt: entry.joinedAt.toISOString(),
  }));

  return { upcoming, past, cancelled, waitlist };
}

export async function cancelClientWaitlistEntry(input: {
  clientId: string;
  waitlistEntryId: string;
}): Promise<void> {
  try {
    await cancelSessionWaitlistEntry({
      clientId: input.clientId,
      waitlistEntryId: input.waitlistEntryId,
    });
  } catch (error) {
    if (error instanceof WaitlistServiceError) {
      if (error.code === "WAITLIST_ENTRY_NOT_FOUND") {
        throw new DashboardServiceError("WAITLIST_ENTRY_NOT_FOUND", error.message);
      }

      if (error.code === "WAITLIST_ENTRY_NOT_OWNED") {
        throw new DashboardServiceError("WAITLIST_ENTRY_NOT_OWNED", error.message);
      }

      if (error.code === "WAITLIST_ENTRY_NOT_ACTIVE") {
        throw new DashboardServiceError("WAITLIST_ENTRY_NOT_ACTIVE", error.message);
      }
    }

    throw error;
  }
}

export async function cancelClientBooking(input: {
  bookingId: string;
  clientId: string;
}): Promise<void> {
  const now = new Date();
  const cutoffHours = await getCancellationCutoffHours();
  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: {
      id: true,
      clientId: true,
      studioSessionId: true,
      status: true,
      selectedEntitlementId: true,
      creditRefundedAt: true,
      studioSession: {
        select: {
          startsAt: true,
          status: true,
        },
      },
    },
  });

  if (!booking) {
    throw new DashboardServiceError("BOOKING_NOT_FOUND", "Booking not found.");
  }

  if (booking.clientId !== input.clientId) {
    throw new DashboardServiceError("BOOKING_NOT_OWNED", "You cannot cancel this booking.");
  }

  try {
    await assertBookingNotCheckedInForCancellation(booking.id);
  } catch (error) {
    if (error instanceof Error && error.message === "BOOKING_ALREADY_CHECKED_IN") {
      throw new DashboardServiceError("BOOKING_ALREADY_CHECKED_IN", "Cannot cancel a booking that has already been checked in.");
    }
    throw error;
  }

  const cancellation = evaluateBookingCancellation({
    bookingStatus: booking.status,
    sessionStatus: booking.studioSession.status,
    sessionStartsAt: booking.studioSession.startsAt,
    now,
    cancellationWindowHours: cutoffHours,
  });
  if (!cancellation.canCancel && cancellation.blockCode === "WINDOW_PASSED") {
    throw new DashboardServiceError(
      "BOOKING_TOO_LATE_TO_CANCEL",
      cancellation.cancellationBlockedReason ?? "Booking can no longer be cancelled.",
    );
  }
  if (!cancellation.canCancel) {
    throw new DashboardServiceError(
      "BOOKING_NOT_CANCELLABLE",
      cancellation.cancellationBlockedReason ?? "This booking cannot be cancelled.",
    );
  }

  const eligibleUntil = cancellation.cancellationEligibleUntilAt;

  const MAX_TRANSACTION_RETRIES = 4;
  let promotionResult:
    | {
        notifications: Array<{
          bookingId: string;
          clientEmail: string;
          clientName: string;
          location: string | null;
          sessionEndsAt: Date;
          sessionStartsAt: Date;
          sessionTitle: string;
          waitlistEntryId: string;
        }>;
      }
    | null = null;

  for (let attempt = 0; attempt <= MAX_TRANSACTION_RETRIES; attempt += 1) {
    try {
      promotionResult = await prisma.$transaction(async (tx) => {
        let refunded = false;

    if (booking.selectedEntitlementId && !booking.creditRefundedAt) {
      const selectedEntitlement = await tx.clientEntitlement.findUnique({
        where: { id: booking.selectedEntitlementId },
        select: { entitlementType: true },
      });

      if (
        selectedEntitlement &&
        (selectedEntitlement.entitlementType === EntitlementType.CREDIT_PACK ||
          selectedEntitlement.entitlementType === EntitlementType.SINGLE_USE)
      ) {
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
          const restoreResult = await restoreCredit({
            clientId: input.clientId,
            entitlementId: booking.selectedEntitlementId,
            bookingId: booking.id,
            reason: "Credit restored after client dashboard cancellation.",
            idempotencyKey: buildBookingCreditLedgerIdempotencyKey({
              type: "RESTORE",
              clientId: input.clientId,
              entitlementId: booking.selectedEntitlementId,
              bookingId: booking.id,
            }),
            prismaClient: tx,
          });
          refunded = restoreResult.restored;
        }
      }
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: now,
        cancellationReason: "Cancelled by client from dashboard.",
        cancelledById: input.clientId,
        cancellationEligibleUntilAt: eligibleUntil,
        creditRefundedAt: refunded ? now : booking.creditRefundedAt,
      },
    });
        return promoteWaitlistAfterCancellationWithinTx(tx, {
          actorUserId: input.clientId,
          now,
          studioSessionId: booking.studioSessionId,
          triggerSource: "DASHBOARD_BOOKING_CANCELLATION",
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      if (attempt < MAX_TRANSACTION_RETRIES && isRetryableSerializationError(error)) {
        await delay(getRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }

  if (!promotionResult) {
    throw new Error("BOOKING_CANCELLATION_TRANSACTION_FAILED");
  }

  await Promise.all(
    promotionResult.notifications.map(async (promotion) => {
      try {
        await sendWaitlistPromotionNotification(promotion);
      } catch (error) {
        console.error("[dashboard-service] waitlist promotion notification failed", {
          waitlistEntryId: promotion.waitlistEntryId,
          bookingId: promotion.bookingId,
          error,
        });
      }
    }),
  );
}

export async function getDashboardMembershipData(
  clientId: string,
): Promise<DashboardMembershipData> {
  const now = new Date();
  const [activeSubscription, activeSubscriptions, entitlements, creditEntitlements] = await prisma.$transaction([
    prisma.subscriptionContract.findFirst({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: now },
      },
      orderBy: { currentPeriodEnd: "asc" },
      select: {
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        product: { select: { name: true } },
      },
    }),
    prisma.subscriptionContract.findMany({
      where: {
        clientId,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gt: now },
      },
      orderBy: { currentPeriodEnd: "asc" },
      select: {
        id: true,
        status: true,
        currentPeriodEnd: true,
        product: { select: { name: true } },
      },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        clientId,
        status: ClientEntitlementStatus.ACTIVE,
        entitlementType: {
          in: [
            EntitlementType.CREDIT_PACK,
            EntitlementType.SINGLE_USE,
            EntitlementType.UNLIMITED_ACCESS,
          ],
        },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        status: true,
        entitlementType: true,
        expiresAt: true,
        product: { select: { name: true } },
      },
    }),
    prisma.clientEntitlement.findMany({
      where: {
        clientId,
        status: ClientEntitlementStatus.ACTIVE,
        entitlementType: {
          in: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
        },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        createdAt: true,
        status: true,
        entitlementType: true,
        expiresAt: true,
        product: { select: { name: true } },
      },
    }),
  ]);

  const entitlementIds = entitlements.map((entitlement) => entitlement.id);
  const entitlementBalances =
    entitlementIds.length > 0
      ? await prisma.creditLedgerEntry.groupBy({
          by: ["entitlementId"],
          where: {
            clientId,
            entitlementId: { in: entitlementIds },
          },
          _sum: { amount: true },
        })
      : [];
  const balanceByEntitlementId = new Map(
    entitlementBalances.map((row) => [row.entitlementId, row._sum.amount ?? 0]),
  );

  const activeCreditPacks = creditEntitlements
    .map((entitlement) => ({
      entitlementId: entitlement.id,
      productName: entitlement.product.name,
      status: entitlement.status,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
      createdAt: entitlement.createdAt,
      remainingCredits: balanceByEntitlementId.get(entitlement.id) ?? 0,
    }))
    .filter((entitlement) => entitlement.remainingCredits > 0)
    .sort((a, b) => {
      const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.POSITIVE_INFINITY;
      const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.POSITIVE_INFINITY;
      if (aExpiry !== bExpiry) {
        return aExpiry - bExpiry;
      }

      const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }

      return a.entitlementId.localeCompare(b.entitlementId);
    })
    .map((entitlement, index) => ({
      entitlementId: entitlement.entitlementId,
      productName: entitlement.productName,
      status: entitlement.status,
      expiresAt: entitlement.expiresAt,
      remainingCredits: entitlement.remainingCredits,
      nextToConsume: index === 0,
    }));

  const usableCredits = activeCreditPacks.reduce((sum, entitlement) => sum + entitlement.remainingCredits, 0);

  const entitlementPlans = entitlements
    .map((entitlement) => {
      const remainingCredits =
        entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
        entitlement.entitlementType === EntitlementType.SINGLE_USE
          ? balanceByEntitlementId.get(entitlement.id) ?? 0
          : null;
      return {
        planId: entitlement.id,
        source: "ENTITLEMENT" as const,
        productName: entitlement.product.name,
        planType: entitlement.entitlementType,
        status: entitlement.status,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        remainingCredits,
      };
    })
    .filter((plan) => plan.remainingCredits === null || plan.remainingCredits > 0);

  const subscriptionPlans = activeSubscriptions.map((subscription) => ({
    planId: subscription.id,
    source: "SUBSCRIPTION" as const,
    productName: subscription.product.name,
    planType: "SUBSCRIPTION" as const,
    status: subscription.status,
    expiresAt: subscription.currentPeriodEnd.toISOString(),
    remainingCredits: null,
  }));

  const [ownedOneTimeProducts, recurringSubscriptions] = await Promise.all([
    getOwnedOneTimeProducts(clientId),
    getOwnedRecurringSubscriptions(clientId),
  ]);
  const stripeCustomerId = await getLatestStripeCustomerIdForUser(clientId);
  const hasStripeRecurringSubscription = recurringSubscriptions.some(
    (subscription) => subscription.provider === "STRIPE",
  );

  return {
    activeSubscription: activeSubscription
      ? {
          productName: activeSubscription.product.name,
          status: activeSubscription.status,
          currentPeriodStart: activeSubscription.currentPeriodStart.toISOString(),
          currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
        }
      : null,
    currentPlans: [...subscriptionPlans, ...entitlementPlans],
    activeCreditPacks,
    ownedOneTimeProducts,
    recurringSubscriptions,
    canManageStripeBilling: Boolean(stripeCustomerId && hasStripeRecurringSubscription),
    usableCredits,
    creditsLeft: usableCredits,
  };
}

export async function getDashboardLoyaltyPlaceholder(clientId: string): Promise<number> {
  const result = await prisma.loyaltyLedgerEntry.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

const ACTIVITY_ALLOWED_FILTERS = ["all", "bookings", "orders", "payments", "subscriptions", "credits"] as const;
type ActivityFilter = (typeof ACTIVITY_ALLOWED_FILTERS)[number];
const ACTIVITY_DEFAULT_PAGE_SIZE = 20;
const ACTIVITY_MAX_PAGE_SIZE = 50;

export type ActivityItem = {
  id: string;
  type: "BOOKING" | "ORDER" | "PAYMENT" | "SUBSCRIPTION" | "CREDIT";
  label: string;
  detail: string | null;
  status: string;
  timestamp: string;
};

export type ActivityPage = {
  items: ActivityItem[];
  filter: ActivityFilter;
  page: number;
  pageSize: number;
  total: number;
};

function normalizeActivityFilter(raw: string | null | undefined): ActivityFilter {
  if (ACTIVITY_ALLOWED_FILTERS.includes(raw as ActivityFilter)) {
    return raw as ActivityFilter;
  }
  return "all";
}

function normalizeActivityPage(raw: string | null | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function normalizeActivityPageSize(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return ACTIVITY_DEFAULT_PAGE_SIZE;
  return Math.min(n, ACTIVITY_MAX_PAGE_SIZE);
}

export async function getClientActivityPage(
  clientId: string,
  params: { filter?: string | null; page?: string | null; pageSize?: string | null },
): Promise<ActivityPage> {
  const filter = normalizeActivityFilter(params.filter);
  const page = normalizeActivityPage(params.page);
  const pageSize = normalizeActivityPageSize(params.pageSize);
  const skip = (page - 1) * pageSize;

  const bookingItems: ActivityItem[] = [];
  const orderItems: ActivityItem[] = [];
  const paymentItems: ActivityItem[] = [];
  const subscriptionItems: ActivityItem[] = [];
  const creditItems: ActivityItem[] = [];

  if (filter === "all" || filter === "bookings") {
    const bookings = await prisma.booking.findMany({
      where: { clientId },
      orderBy: { bookedAt: "desc" },
      skip: filter === "bookings" ? skip : 0,
      take: filter === "bookings" ? pageSize : 200,
      select: {
        id: true,
        status: true,
        bookedAt: true,
        studioSession: {
          select: { title: true, startsAt: true },
        },
      },
    });
    for (const b of bookings) {
      bookingItems.push({
        id: b.id,
        type: "BOOKING",
        label: b.studioSession.title,
        detail: b.studioSession.startsAt.toISOString(),
        status: b.status,
        timestamp: b.bookedAt.toISOString(),
      });
    }
  }

  if (filter === "all" || filter === "orders") {
    const orders = await prisma.order.findMany({
      where: { clientId },
      orderBy: { placedAt: "desc" },
      skip: filter === "orders" ? skip : 0,
      take: filter === "orders" ? pageSize : 200,
      select: {
        id: true,
        status: true,
        placedAt: true,
        totalAmountMinor: true,
        currencyCode: true,
        items: {
          take: 1,
          select: { productNameSnapshot: true },
        },
      },
    });
    for (const o of orders) {
      const label = o.items[0]?.productNameSnapshot ?? "Order";
      const amount = `${(o.totalAmountMinor / 100).toFixed(2)} ${o.currencyCode}`;
      orderItems.push({
        id: o.id,
        type: "ORDER",
        label,
        detail: amount,
        status: o.status,
        timestamp: o.placedAt.toISOString(),
      });
    }
  }

  if (filter === "all" || filter === "payments") {
    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { order: { clientId } },
          { booking: { clientId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      skip: filter === "payments" ? skip : 0,
      take: filter === "payments" ? pageSize : 200,
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currencyCode: true,
        method: true,
        createdAt: true,
      },
    });
    for (const p of payments) {
      const amount = `${(p.amountMinor / 100).toFixed(2)} ${p.currencyCode}`;
      paymentItems.push({
        id: p.id,
        type: "PAYMENT",
        label: `Payment via ${p.method}`,
        detail: amount,
        status: p.status,
        timestamp: p.createdAt.toISOString(),
      });
    }
  }

  if (filter === "all" || filter === "subscriptions") {
    const subscriptions = await prisma.subscriptionContract.findMany({
      where: { clientId },
      orderBy: { createdAt: "desc" },
      skip: filter === "subscriptions" ? skip : 0,
      take: filter === "subscriptions" ? pageSize : 200,
      select: {
        id: true,
        status: true,
        createdAt: true,
        currentPeriodEnd: true,
        product: { select: { name: true } },
      },
    });
    for (const s of subscriptions) {
      subscriptionItems.push({
        id: s.id,
        type: "SUBSCRIPTION",
        label: s.product.name,
        detail: s.currentPeriodEnd.toISOString(),
        status: s.status,
        timestamp: s.createdAt.toISOString(),
      });
    }
  }

  if (filter === "all" || filter === "credits") {
    const credits = await prisma.creditLedgerEntry.findMany({
      where: { clientId },
      orderBy: { happenedAt: "desc" },
      skip: filter === "credits" ? skip : 0,
      take: filter === "credits" ? pageSize : 200,
      select: {
        id: true,
        entryType: true,
        amount: true,
        happenedAt: true,
        notes: true,
      },
    });
    for (const c of credits) {
      const sign = c.amount > 0 ? `+${c.amount}` : String(c.amount);
      creditItems.push({
        id: c.id,
        type: "CREDIT",
        label: c.entryType,
        detail: `${sign} credit${Math.abs(c.amount) !== 1 ? "s" : ""}${c.notes ? ` — ${c.notes}` : ""}`,
        status: c.entryType,
        timestamp: c.happenedAt.toISOString(),
      });
    }
  }

  const combined = [...bookingItems, ...orderItems, ...paymentItems, ...subscriptionItems, ...creditItems].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const total = combined.length;
  const paginated = filter === "all" ? combined.slice(skip, skip + pageSize) : combined;

  return {
    items: paginated,
    filter,
    page,
    pageSize,
    total,
  };
}

export type ClientSubscriptionRecoveryState =
  | { status: "HEALTHY" }
  | { status: "PAST_DUE"; contractId: string; productName: string }
  | { status: "NONE" };

export async function getClientSubscriptionRecoveryState(
  clientId: string,
): Promise<ClientSubscriptionRecoveryState> {
  const now = new Date();

  const active = await prisma.subscriptionContract.findFirst({
    where: {
      clientId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: { gt: now },
      OR: [{ endedAt: null }, { endedAt: { gt: now } }],
    },
    select: { id: true },
  });

  if (active) {
    return { status: "HEALTHY" };
  }

  const pastDue = await prisma.subscriptionContract.findFirst({
    where: {
      clientId,
      status: SubscriptionStatus.PAST_DUE,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      product: { select: { name: true } },
    },
  });

  if (pastDue) {
    return {
      status: "PAST_DUE",
      contractId: pastDue.id,
      productName: pastDue.product.name,
    };
  }

  return { status: "NONE" };
}

export type StoreOrderItem = {
  id: string;
  productNameSnapshot: string;
  productType: ProductType;
  imageAsset: Pick<MediaAssetReadModel, "id" | "path" | "mimeType" | "sizeBytes" | "originalFilename"> | null;
  quantity: number;
  unitAmountMinor: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
};

export type StoreOrderSummary = {
  id: string;
  status: OrderStatus;
  placedAt: string;
  totalAmountMinor: number;
  currencyCode: string;
  items: StoreOrderItem[];
  fulfillmentNote: string | null;
};

export type OrderLineItem = {
  id: string;
  productNameSnapshot: string;
  productType: ProductType;
  imageAsset: Pick<MediaAssetReadModel, "id" | "path" | "mimeType" | "sizeBytes" | "originalFilename"> | null;
  quantity: number;
  unitAmountMinor: number;
  lineTotalAmountMinor: number;
  currencyCode: string;
  giftCardCode: { maskedCode: string; status: GiftCardCodeStatus } | null;
};

export type OrderSummary = {
  id: string;
  status: OrderStatus;
  placedAt: string;
  totalAmountMinor: number;
  currencyCode: string;
  items: OrderLineItem[];
  fulfillmentNote: string | null;
};

export async function getClientStoreOrderHistory(clientId: string): Promise<StoreOrderSummary[]> {
  const orders = await prisma.order.findMany({
    where: {
      clientId,
      // DRAFT orders are incomplete checkout artifacts and must not appear in client purchase history
      status: { not: OrderStatus.DRAFT },
      items: {
        some: {
          product: {
            productType: { in: [...STORE_PRODUCT_TYPES] },
          },
        },
      },
    },
    orderBy: { placedAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      placedAt: true,
      totalAmountMinor: true,
      currencyCode: true,
      items: {
        select: {
          id: true,
          productNameSnapshot: true,
          quantity: true,
          unitAmountMinor: true,
          lineTotalAmountMinor: true,
          currencyCode: true,
          product: {
            select: {
              productType: true,
              imageAsset: {
                select: {
                  id: true,
                  path: true,
                  mimeType: true,
                  sizeBytes: true,
                  originalFilename: true,
                },
              },
            },
          },
        },
      },
    },
  });

  return Promise.all(orders.map(async (order) => {
    const hasMerchandise = order.items.some(
      (item) => item.product.productType === ProductType.MERCHANDISE,
    );
    const items = await Promise.all(order.items.map(async (item) => ({
      id: item.id,
      productNameSnapshot: item.productNameSnapshot,
      productType: item.product.productType,
      imageAsset: await getRenderableOrderImageAsset(item.product.imageAsset),
      quantity: item.quantity,
      unitAmountMinor: item.unitAmountMinor,
      lineTotalAmountMinor: item.lineTotalAmountMinor,
      currencyCode: item.currencyCode,
    })));

    return {
      id: order.id,
      status: order.status,
      placedAt: order.placedAt.toISOString(),
      totalAmountMinor: order.totalAmountMinor,
      currencyCode: order.currencyCode,
      items,
      fulfillmentNote: hasMerchandise ? STORE_PICKUP_WORDING : null,
    };
  }));
}

export async function getClientOrderHistory(clientId: string): Promise<OrderSummary[]> {
  const orders = await prisma.order.findMany({
    where: {
      clientId,
      // DRAFT orders are incomplete checkout artifacts and must not appear in client purchase history
      status: { not: OrderStatus.DRAFT },
    },
    orderBy: { placedAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      placedAt: true,
      totalAmountMinor: true,
      currencyCode: true,
      items: {
        select: {
          id: true,
          productNameSnapshot: true,
          quantity: true,
          unitAmountMinor: true,
          lineTotalAmountMinor: true,
          currencyCode: true,
          product: {
            select: {
              productType: true,
              imageAsset: {
                select: {
                  id: true,
                  path: true,
                  mimeType: true,
                  sizeBytes: true,
                  originalFilename: true,
                },
              },
            },
          },
          giftCardCode: { select: { maskedCode: true, status: true } },
        },
      },
    },
  });

  return Promise.all(orders.map(async (order) => {
    const hasMerchandise = order.items.some(
      (item) => item.product.productType === ProductType.MERCHANDISE,
    );
    const items = await Promise.all(order.items.map(async (item) => ({
      id: item.id,
      productNameSnapshot: item.productNameSnapshot,
      productType: item.product.productType,
      imageAsset: await getRenderableOrderImageAsset(item.product.imageAsset),
      quantity: item.quantity,
      unitAmountMinor: item.unitAmountMinor,
      lineTotalAmountMinor: item.lineTotalAmountMinor,
      currencyCode: item.currencyCode,
      giftCardCode: item.giftCardCode
        ? { maskedCode: item.giftCardCode.maskedCode, status: item.giftCardCode.status }
        : null,
    })));

    return {
      id: order.id,
      status: order.status,
      placedAt: order.placedAt.toISOString(),
      totalAmountMinor: order.totalAmountMinor,
      currencyCode: order.currencyCode,
      items,
      fulfillmentNote: hasMerchandise ? STORE_PICKUP_WORDING : null,
    };
  }));
}

async function getRenderableOrderImageAsset<T extends { path: string }>(asset: T | null): Promise<T | null> {
  if (!asset) {
    return null;
  }

  const renderState = await getCanonicalMediaRenderState(asset.path, { allowedFolders: ["products"] });
  return renderState.src ? asset : null;
}
