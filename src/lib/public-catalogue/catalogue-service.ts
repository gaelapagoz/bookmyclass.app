import { ServicePricingMode, StudioSessionStatus, Weekday, type Prisma } from "@prisma/client";
import { prisma } from "../db";
import { createPerfTrace } from "../monitoring/perf-trace";
import { createInMemoryTtlCache } from "../cache/in-memory-ttl-cache";
import { getCanonicalMediaRenderState } from "../media";

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

const PUBLIC_CATALOGUE_CACHE_TTL_MS = 30_000;
const categoriesCache = createInMemoryTtlCache<PublicCategory[]>({
  defaultTtlMs: PUBLIC_CATALOGUE_CACHE_TTL_MS,
});
const servicesByCategoryCache = createInMemoryTtlCache<PublicService[]>({
  defaultTtlMs: PUBLIC_CATALOGUE_CACHE_TTL_MS,
});

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

async function getPublicServiceImageUrl(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl?.startsWith("/uploads/")) {
    return null;
  }
  const renderState = await getCanonicalMediaRenderState(imageUrl, { allowedFolders: ["classes"] });
  return renderState.src;
}

async function toService(classType: ClassTypeWithSchedule): Promise<PublicService> {
  return {
    id: classType.id,
    slug: classType.slug,
    title: classType.name,
    imageUrl: await getPublicServiceImageUrl(classType.imageUrl),
    shortDescription: getShortDescription(classType.description),
    description: classType.description ?? "Description coming soon.",
    durationMinutes: classType.defaultDurationMinutes,
    pricingMode: classType.pricingMode,
    weekdaySummary: toWeekdaySummary(classType),
  };
}

export async function getPublicCategories(): Promise<PublicCategory[]> {
  const trace = createPerfTrace("public-catalogue.getPublicCategories");
  let categoryCount = 0;
  try {
    const categories = await categoriesCache.getOrLoad("public-categories", () =>
      trace.db("classCategory.findMany.publicCategories", () =>
        prisma.classCategory.findMany({
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
        }),
      ),
    );
    categoryCount = categories.length;
    return categories;
  } finally {
    trace.log({ categoryCount });
  }
}

export async function getPublicServicesByCategorySlug(categorySlug: string): Promise<PublicService[]> {
  const trace = createPerfTrace("public-catalogue.getPublicServicesByCategorySlug", { categorySlug });
  let serviceCount = 0;
  try {
    const classTypes = await servicesByCategoryCache.getOrLoad(
      `services:${categorySlug.toLowerCase()}`,
      () =>
        trace.db("classType.findMany.servicesByCategory", async () => {
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

          return Promise.all(classTypes.map(toService));
        }),
      PUBLIC_CATALOGUE_CACHE_TTL_MS,
    );
    serviceCount = classTypes.length;
    return classTypes;
  } finally {
    trace.log({ categorySlug, serviceCount });
  }
}

export function clearPublicCatalogueCaches() {
  categoriesCache.clear();
  servicesByCategoryCache.clear();
}
