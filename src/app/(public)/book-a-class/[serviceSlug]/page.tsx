import { notFound } from "next/navigation";
import { ServiceBookingExperience } from "../../../../components/book-a-class/service-detail/ServiceBookingExperience";
import {
  getPublicServiceDetailBySlug,
  getServiceMonthAvailability,
  getServiceSlotsByDate,
} from "../../../../lib/public-catalogue/availability-service";
import { getStudioMonthKey } from "../../../../lib/public-catalogue/timezone";

export default async function ServiceBookingPage({
  params,
}: {
  params: Promise<{ serviceSlug: string }>;
}) {
  const { serviceSlug } = await params;
  const service = await getPublicServiceDetailBySlug(serviceSlug);

  if (!service) {
    notFound();
  }

  const currentMonthKey = getStudioMonthKey(new Date());
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
      service={service}
      initialMonthKey={currentMonthKey}
      initialAvailabilityDays={monthAvailability?.days ?? []}
      initialSelectedDate={initialSelectedDate}
      initialSlots={slotsResponse?.slots ?? []}
    />
  );
}
