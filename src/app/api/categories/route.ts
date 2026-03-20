import { NextResponse } from "next/server";
import { getPublicCategories } from "../../../lib/public-catalogue/catalogue-service";

export async function GET() {
  const categories = await getPublicCategories();

  return NextResponse.json({ categories });
}
