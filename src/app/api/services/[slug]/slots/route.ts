import { NextResponse } from "next/server";
import { getServiceSlotsByDate } from "../../../../../lib/public-catalogue/availability-service";
import { isValidDateKey } from "../../../../../lib/public-catalogue/timezone";

const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/i;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json(
      { date: null, timezone: null, slots: [], error: "Invalid service slug." },
      { status: 400 },
    );
  }

  const date = new URL(request.url).searchParams.get("date");

  if (!isValidDateKey(date)) {
    return NextResponse.json(
      { date: null, timezone: null, slots: [], error: "Query parameter `date` must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const slots = await getServiceSlotsByDate({ slug, dateKey: date });

  if (!slots) {
    return NextResponse.json({ date, timezone: null, slots: [] }, { status: 404 });
  }

  return NextResponse.json(slots);
}
