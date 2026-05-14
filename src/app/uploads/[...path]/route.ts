import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { NextResponse } from "next/server";

import { toCanonicalMediaAbsolutePath } from "@/lib/media";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const publicPath = `/uploads/${path.join("/")}`;
  const contentType = CONTENT_TYPES[extname(publicPath).toLowerCase()];

  if (!contentType) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const absolutePath = toCanonicalMediaAbsolutePath(publicPath);
    const bytes = await readFile(absolutePath);
    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
