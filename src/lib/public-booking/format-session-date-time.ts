import { STUDIO_TIMEZONE, getStudioTimeLabel } from "../public-catalogue/timezone";

export function formatSessionDateTime(input: {
  startsAt: Date;
  endsAt: Date;
}): string {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: STUDIO_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(input.startsAt);

  const startTime = getStudioTimeLabel(input.startsAt);
  const endTime = getStudioTimeLabel(input.endsAt);

  return `${dateLabel} · ${startTime} - ${endTime}`;
}
