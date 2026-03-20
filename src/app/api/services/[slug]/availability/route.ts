import { NextResponse } from "next/server";
import { getServiceMonthAvailability } from "../../../../../lib/public-catalogue/availability-service";
import { isValidMonthKey } from "../../../../../lib/public-catalogue/timezone";

const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/i;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { month: null, timezone: null, days: [], error: "Invalid service slug." },
      { status: 400 },
    );
  }

  const month = new URL(request.url).searchParams.get("month");

  if (!isValidMonthKey(month)) {
    return NextResponse.json(
      { month: null, timezone: null, days: [], error: "Query parameter `month` must use YYYY-MM." },
      { status: 400 },
    );
  }

  const availability = await getServiceMonthAvailability({ slug, monthKey: month });

  if (!availability) {
    return NextResponse.json({ month, timezone: null, days: [] }, { status: 404 });
  }

  return NextResponse.json(availability);
}
