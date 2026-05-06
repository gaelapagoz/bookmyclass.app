import { notFound } from "next/navigation";
import { auth } from "../../../../auth";
import { ServiceBookingExperience } from "../../../../components/book-a-class/service-detail/ServiceBookingExperience";
import {
  getPublicServiceDetailBySlug,
  getServiceMonthAvailability,
  getServiceSlotsByDate,
} from "../../../../lib/public-catalogue/availability-service";
import { getSiteDateKey, getSiteMonthKey } from "../../../../lib/public-catalogue/timezone";
import { getSiteTimeZone } from "../../../../lib/site-settings/site-settings-service";

export default async function ServiceBookingPage({
  params,
}: {
  params: Promise<{ serviceSlug: string }>;
}) {
  const { serviceSlug } = await params;
  const session = await auth();
  const service = await getPublicServiceDetailBySlug(serviceSlug);

  if (!service) {
    notFound();
  }

  const siteTimeZone = await getSiteTimeZone();
  const now = new Date();
  const currentMonthKey = getSiteMonthKey(now, siteTimeZone);
  const todayDateKey = getSiteDateKey(now, siteTimeZone);
  const monthAvailability = await getServiceMonthAvailability({
    slug: serviceSlug,
    monthKey: currentMonthKey,
  });

  const initialSelectedDate = monthAvailability?.days.find((day) => day.hasAvailability)?.date ?? null;
  const slotsResponse = initialSelectedDate
    ? await getServiceSlotsByDate({ slug: serviceSlug, dateKey: initialSelectedDate })
    : null;

  return (
    <ServiceBookingExperience
      isAuthenticated={Boolean(session?.user)}
      service={service}
      initialMonthKey={currentMonthKey}
      initialAvailabilityDays={monthAvailability?.days ?? []}
      initialSelectedDate={initialSelectedDate}
      initialSlots={slotsResponse?.slots ?? []}
      todayDateKey={todayDateKey}
    />
  );
}
