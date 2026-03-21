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

type DashboardServiceErrorCode =
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_OWNED"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_TOO_LATE_TO_CANCEL"
  | "EMAIL_ALREADY_IN_USE"
  | "INVALID_PROFILE_INPUT";

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
};

export type DashboardHomeData = {
  userName: string;
  nextUpcomingBooking: DashboardBookingItem | null;
  activeSubscription: {
    productName: string;
    currentPeriodEnd: string;
  } | null;
  creditsLeft: number;
  loyaltyPointsPlaceholder: number;
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
  usablePlans: Array<{
    entitlementId: string;
    productName: string;
    entitlementType: EntitlementType;
    expiresAt: string | null;
    remainingCredits: number | null;
  }>;
  creditsLeft: number;
};

function toBookingItem(input: {
  booking: {
    id: string;
    status: BookingStatus;
    cancellationEligibleUntilAt: Date | null;
    cancelledAt: Date | null;
    studioSession: {
      title: string;
      startsAt: Date;
      endsAt: Date;
      location: string | null;
      status: StudioSessionStatus;
    };
  };
  now: Date;
}): DashboardBookingItem {
  const { booking, now } = input;
  const session = booking.studioSession;
  const isFuture = session.startsAt > now;
  const eligibleUntil =
    booking.cancellationEligibleUntilAt && booking.cancellationEligibleUntilAt > now;
  const canCancel =
    booking.status !== BookingStatus.CANCELLED &&
    session.status === StudioSessionStatus.SCHEDULED &&
    isFuture &&
    Boolean(eligibleUntil);

  return {
    bookingId: booking.id,
    status: booking.status,
    serviceTitle: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    location: session.location,
    cancellationEligibleUntilAt: booking.cancellationEligibleUntilAt?.toISOString() ?? null,
    canCancel,
  };
}

async function getCancellationCutoffHours(): Promise<number> {
  const policy = await prisma.bookingPolicy.findUnique({
    where: { scope: "GLOBAL" },
    select: { cancellationCutoffHours: true },
  });

  return policy?.cancellationCutoffHours ?? 24;
}

async function computeCreditBalanceForEntitlement(entitlementId: string): Promise<number> {
  const result = await prisma.creditLedgerEntry.aggregate({
    where: { entitlementId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

export async function getCreditsLeft(clientId: string): Promise<number> {
  const result = await prisma.creditLedgerEntry.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}

export async function getDashboardHomeData(clientId: string): Promise<DashboardHomeData> {
  const now = new Date();
  const [user, activeSubscription, creditsLeft, loyaltyPoints, upcoming, recent] =
    await prisma.$transaction([
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
      prisma.creditLedgerEntry.aggregate({
        where: { clientId },
        _sum: { amount: true },
      }),
      prisma.loyaltyLedgerEntry.aggregate({
        where: { clientId },
        _sum: { amount: true },
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
          cancellationEligibleUntilAt: true,
          cancelledAt: true,
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
          cancellationEligibleUntilAt: true,
          cancelledAt: true,
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
    ]);

  return {
    userName: user.firstName?.trim() || user.name,
    nextUpcomingBooking: upcoming ? toBookingItem({ booking: upcoming, now }) : null,
    activeSubscription: activeSubscription
      ? {
          productName: activeSubscription.product.name,
          currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
        }
      : null,
    creditsLeft: creditsLeft._sum.amount ?? 0,
    loyaltyPointsPlaceholder: loyaltyPoints._sum.amount ?? 0,
    recentBookings: recent.map((booking) => toBookingItem({ booking, now })),
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
  },
): Promise<void> {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const email = input.email.trim().toLowerCase();
  const phone = input.phone.trim();
  const name = `${firstName} ${lastName}`.trim();

  if (!firstName || !lastName || !email) {
    throw new DashboardServiceError("INVALID_PROFILE_INPUT", "Invalid profile input.");
  }

  try {
    await prisma.user.update({
      where: { id: clientId },
      data: {
        firstName,
        lastName,
        name,
        email,
        clientProfile: {
          upsert: {
            update: { phone: phone || null },
            create: { phone: phone || null },
          },
        },
      },
    });
  } catch (error) {
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
  const bookings = await prisma.booking.findMany({
    where: { clientId },
    orderBy: [{ studioSession: { startsAt: "desc" } }, { bookedAt: "desc" }],
    select: {
      id: true,
      status: true,
      cancellationEligibleUntilAt: true,
      cancelledAt: true,
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

  const mapped = bookings.map((booking) => toBookingItem({ booking, now }));
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
      cancellationEligibleUntilAt: true,
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

  if (
    booking.status === BookingStatus.CANCELLED ||
    booking.studioSession.status !== StudioSessionStatus.SCHEDULED
  ) {
    throw new DashboardServiceError(
      "BOOKING_NOT_CANCELLABLE",
      "This booking cannot be cancelled.",
    );
  }

  if (booking.studioSession.startsAt <= now) {
    throw new DashboardServiceError(
      "BOOKING_NOT_CANCELLABLE",
      "Past bookings cannot be cancelled.",
    );
  }

  const computedEligibleUntil = new Date(
    booking.studioSession.startsAt.getTime() - cutoffHours * 60 * 60 * 1000,
  );
  const eligibleUntil = booking.cancellationEligibleUntilAt ?? computedEligibleUntil;
  if (now > eligibleUntil) {
    throw new DashboardServiceError(
      "BOOKING_TOO_LATE_TO_CANCEL",
      "Booking can no longer be cancelled less than 24 hours before session start.",
    );
  }

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
  const [activeSubscription, entitlements, creditsLeft] = await prisma.$transaction([
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
    prisma.clientEntitlement.findMany({
      where: {
        clientId,
        status: ClientEntitlementStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        entitlementType: true,
        expiresAt: true,
        product: { select: { name: true } },
      },
    }),
    prisma.creditLedgerEntry.aggregate({
      where: { clientId },
      _sum: { amount: true },
    }),
  ]);

  const usablePlans = await Promise.all(
    entitlements.map(async (entitlement) => {
      const remainingCredits =
        entitlement.entitlementType === EntitlementType.CREDIT_PACK ||
        entitlement.entitlementType === EntitlementType.SINGLE_USE
          ? await computeCreditBalanceForEntitlement(entitlement.id)
          : null;

      return {
        entitlementId: entitlement.id,
        productName: entitlement.product.name,
        entitlementType: entitlement.entitlementType,
        expiresAt: entitlement.expiresAt?.toISOString() ?? null,
        remainingCredits,
      };
    }),
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
    usablePlans,
    creditsLeft: creditsLeft._sum.amount ?? 0,
  };
}

export async function getDashboardLoyaltyPlaceholder(clientId: string): Promise<number> {
  const result = await prisma.loyaltyLedgerEntry.aggregate({
    where: { clientId },
    _sum: { amount: true },
  });

  return result._sum.amount ?? 0;
}
