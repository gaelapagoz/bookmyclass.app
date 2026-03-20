import { NextResponse } from "next/server";
import { getNextAvailability } from "../../../../../lib/public-catalogue/availability-service";
import { isValidDateKey } from "../../../../../lib/public-catalogue/timezone";

const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/i;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ timezone: null, next: null, error: "Invalid service slug." }, { status: 400 });
  }

  const from = new URL(request.url).searchParams.get("from");

  if (!isValidDateKey(from)) {
    return NextResponse.json(
      { timezone: null, next: null, error: "Query parameter `from` must use YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const availability = await getNextAvailability({ slug, fromDateKey: from });

  if (!availability) {
    return NextResponse.json({ timezone: null, next: null }, { status: 404 });
  }

  return NextResponse.json(availability);
}
