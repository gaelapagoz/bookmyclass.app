import { prisma } from "@/lib/db";
import {
  DEFAULT_SITE_TIME_ZONE,
  isValidIanaTimeZone,
  normalizeSiteTimeZone,
} from "@/lib/site-settings/site-timezone";

export {
  DEFAULT_SITE_TIME_ZONE,
  formatTimeZoneOptionLabel,
  getSiteTimeZoneOptions,
  getSupportedIanaTimeZones,
  isValidIanaTimeZone,
  normalizeSiteTimeZone,
  type SiteTimeZoneOption,
} from "@/lib/site-settings/site-timezone";

export type SiteSettings = {
  timeZone: string;
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const settings = await prisma.siteSettings.findUnique({
    where: { scope: "GLOBAL" },
    select: { timeZone: true },
  });

  if (!settings) {
    return { timeZone: DEFAULT_SITE_TIME_ZONE };
  }

  if (!isValidIanaTimeZone(settings.timeZone)) {
    return { timeZone: DEFAULT_SITE_TIME_ZONE };
  }

  return { timeZone: settings.timeZone };
}

export async function getSiteTimeZone(): Promise<string> {
  const settings = await getSiteSettings();
  return settings.timeZone;
}

export async function updateSiteTimeZone(timeZone: string): Promise<string> {
  const normalizedTimeZone = normalizeSiteTimeZone(timeZone);
  const settings = await prisma.siteSettings.upsert({
    where: { scope: "GLOBAL" },
    create: {
      scope: "GLOBAL",
      timeZone: normalizedTimeZone,
    },
    update: {
      timeZone: normalizedTimeZone,
    },
    select: {
      timeZone: true,
    },
  });

  return settings.timeZone;
}
