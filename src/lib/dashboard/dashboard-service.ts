import {
  BookingStatus,
  ClientEntitlementStatus,
  CreditLedgerEntryType,
  EntitlementType,
  Prisma,
  SubscriptionStatus,
  StudioSessionStatus,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestEmailChange, UserIdentityError } from "@/lib/auth/user-identity-service";
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

type DashboardServiceErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_OWNED"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_TOO_LATE_TO_CANCEL"
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

function toBookingItem(input: {
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
  now: Date;
  cancellationCutoffHours: number;
}): DashboardBookingItem {
  const { booking, now, cancellationCutoffHours } = input;
  const session = booking.studioSession;
  const cancellation = evaluateBookingCancellation({
    bookingStatus: booking.status,
    sessionStatus: session.status,
    sessionStartsAt: session.startsAt,
    now,
    cancellationWindowHours: cancellationCutoffHours,
  });

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
  };
}

async function getCancellationCutoffHours(): Promise<number> {
  const policy = await prisma.bookingPolicy.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      cancellationCutoffHours: 24,
    },
    update: {},
    select: { cancellationCutoffHours: true },
  });

  return normalizeBookingCancellationWindowHours(policy.cancellationCutoffHours);
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
      ? toBookingItem({ booking: upcoming, now, cancellationCutoffHours })
      : null,
    activeSubscription: activeSubscription
      ? {
          productName: activeSubscription.product.name,
          currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
        }
      : null,
    creditsLeft: usableCredits,
    recentBookings: recent.map((booking) =>
      toBookingItem({ booking, now, cancellationCutoffHours }),
    ),
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
  const bookings = await prisma.booking.findMany({
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
  });

  const mapped = bookings.map((booking) =>
    toBookingItem({ booking, now, cancellationCutoffHours }),
  );
  const upcoming = mapped.filter(
    (booking) =>
      booking.status !== BookingStatus.CANCELLED &&
      new Date(booking.startsAt) > now,
  );
  const cancelled = mapped.filter((booking) => booking.status === BookingStatus.CANCELLED);
  const past = mapped.filter(
    (booking) =>
      booking.status !== BookingStatus.CANCELLED &&
      new Date(booking.startsAt) <= now,
  );

  return { upcoming, past, cancelled };
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

  await prisma.$transaction(async (tx) => {
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
          await tx.creditLedgerEntry.create({
            data: {
              clientId: input.clientId,
              entitlementId: booking.selectedEntitlementId,
              bookingId: booking.id,
              entryType: CreditLedgerEntryType.RESTORE,
              amount: 1,
              notes: "Credit restored after client dashboard cancellation.",
            },
          });
          refunded = true;
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
  });
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
