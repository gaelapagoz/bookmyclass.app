import { NextResponse } from "next/server";
import { getPublicServicesByCategorySlug } from "../../../lib/public-catalogue/catalogue-service";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category")?.trim();

  if (!category) {
    return NextResponse.json(
      { services: [], error: "Query parameter `category` is required." },
      { status: 400 },
    );
  }

  if (!/^[a-z0-9-]{1,100}$/i.test(category)) {
    return NextResponse.json(
      { services: [], error: "Query parameter `category` is invalid." },
      { status: 400 },
    );
  }

  const services = await getPublicServicesByCategorySlug(category);

  return NextResponse.json({ services });
}
