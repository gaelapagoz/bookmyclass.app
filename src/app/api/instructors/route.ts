import { NextResponse } from "next/server";
import { getPublicInstructors } from "../../../lib/public-content/team-service";

export async function GET() {
  const instructors = await getPublicInstructors();
  return NextResponse.json({ instructors });
}
