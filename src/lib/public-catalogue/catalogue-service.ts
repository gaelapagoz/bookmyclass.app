import { ServicePricingMode, StudioSessionStatus, Weekday, type Prisma } from "@prisma/client";
import { prisma } from "../db";

export type PublicCategory = {
  name: string;
  slug: string;
};

export type PublicService = {
  description: string;
  durationMinutes: number;
  id: string;
  imageUrl: string | null;
  pricingMode: ServicePricingMode;
  shortDescription: string;
  slug: string;
  title: string;
  weekdaySummary: string;
};

type ClassTypeWithSchedule = Prisma.ClassTypeGetPayload<{
  include: {
    studioSessions: {
      where: {
        isPublished: true;
        status: "SCHEDULED";
      };
      select: { startsAt: true };
      orderBy: { startsAt: "asc" };
      take: 8;
    };
    templates: {
      where: {
        isActive: true;
        isPublished: true;
      };
      include: {
        recurringRules: {
          where: { isActive: true };
          select: { weekday: true };
        };
      };
    };
  };
}>;

const weekdayOrder: Weekday[] = [
  Weekday.MONDAY,
  Weekday.TUESDAY,
  Weekday.WEDNESDAY,
  Weekday.THURSDAY,
  Weekday.FRIDAY,
  Weekday.SATURDAY,
  Weekday.SUNDAY,
];

const weekdayLabel: Record<Weekday, string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function formatOrderedWeekdays(weekdays: Set<Weekday>): string {
  const ordered = weekdayOrder.filter((weekday) => weekdays.has(weekday));
  return ordered.map((weekday) => weekdayLabel[weekday]).join(", ");
}

function getShortDescription(description: string | null): string {
  if (!description) {
    return "Details coming soon.";
  }

  const trimmed = description.trim();

  if (trimmed.length <= 120) {
    return trimmed;
  }

  return `${trimmed.slice(0, 117).trimEnd()}...`;
}

function weekdayFromDate(date: Date): Weekday {
  const day = date.getUTCDay();
  switch (day) {
    case 0:
      return Weekday.SUNDAY;
    case 1:
      return Weekday.MONDAY;
    case 2:
      return Weekday.TUESDAY;
    case 3:
      return Weekday.WEDNESDAY;
    case 4:
      return Weekday.THURSDAY;
    case 5:
      return Weekday.FRIDAY;
    default:
      return Weekday.SATURDAY;
  }
}

function toWeekdaySummary(classType: ClassTypeWithSchedule): string {
  const recurringWeekdays = new Set<Weekday>();

  for (const template of classType.templates) {
    for (const rule of template.recurringRules) {
      recurringWeekdays.add(rule.weekday);
    }
  }

  if (recurringWeekdays.size > 0) {
    return formatOrderedWeekdays(recurringWeekdays);
  }

  const sessionDays = new Set<Weekday>();
  for (const session of classType.studioSessions) {
    sessionDays.add(weekdayFromDate(session.startsAt));
  }

  if (sessionDays.size > 0) {
    return formatOrderedWeekdays(sessionDays);
  }

  return "Schedule announced soon";
}

function toService(classType: ClassTypeWithSchedule): PublicService {
  return {
    id: classType.id,
    slug: classType.slug,
    title: classType.name,
    imageUrl: classType.imageUrl,
    shortDescription: getShortDescription(classType.description),
    description: classType.description ?? "Description coming soon.",
    durationMinutes: classType.defaultDurationMinutes,
    pricingMode: classType.pricingMode,
    weekdaySummary: toWeekdaySummary(classType),
  };
}

export async function getPublicCategories(): Promise<PublicCategory[]> {
  return prisma.classCategory.findMany({
    where: {
      isActive: true,
      classTypes: {
        some: {
          isActive: true,
          isVisible: true,
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      slug: true,
      name: true,
    },
  });
}

export async function getPublicServicesByCategorySlug(categorySlug: string): Promise<PublicService[]> {
  const classTypes = await prisma.classType.findMany({
    where: {
      category: {
        isActive: true,
        slug: categorySlug,
      },
      isActive: true,
      isVisible: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      templates: {
        where: {
          isActive: true,
          isPublished: true,
        },
        include: {
          recurringRules: {
            where: {
              isActive: true,
            },
            select: {
              weekday: true,
            },
          },
        },
      },
      studioSessions: {
        where: {
          isPublished: true,
          status: StudioSessionStatus.SCHEDULED,
        },
        orderBy: {
          startsAt: "asc",
        },
        select: {
          startsAt: true,
        },
        take: 8,
      },
    },
  });

  return classTypes.map(toService);
}
