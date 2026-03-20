import { NextResponse } from "next/server";
import { getPublicServiceDetailBySlug } from "../../../../lib/public-catalogue/availability-service";

const SLUG_PATTERN = /^[a-z0-9-]{1,100}$/i;

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  if (!SLUG_PATTERN.test(slug)) {
    return NextResponse.json({ service: null, error: "Invalid service slug." }, { status: 400 });
  }

  const service = await getPublicServiceDetailBySlug(slug);

  if (!service) {
    return NextResponse.json({ service: null }, { status: 404 });
  }

  return NextResponse.json({ service });
}
