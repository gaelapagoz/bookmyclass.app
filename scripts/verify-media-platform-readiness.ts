import "dotenv/config";

import prisma from "../src/lib/db";
import {
  evaluateMediaHardCutoverReadiness,
  LEGACY_MEDIA_PATH_PATTERNS,
} from "../src/lib/readiness/hard-cutover-readiness";
import { verifyMediaRuntime } from "./media-server-verify-runtime";

function legacyContainsFilter(field: "path" | "image" | "imageUrl" | "picture1" | "picture2" | "picture3" | "thumbnail") {
  return LEGACY_MEDIA_PATH_PATTERNS.map((pattern) => ({ [field]: { contains: pattern, mode: "insensitive" as const } }));
}

async function countLegacyMediaPaths(): Promise<Array<{ label: string; count: number }>> {
  const mediaAssetLegacyCount = await prisma.mediaAsset.count({
    where: {
      OR: legacyContainsFilter("path"),
    },
  });

  const userLegacyCount = await prisma.user.count({
    where: {
      OR: legacyContainsFilter("image"),
    },
  });

  const classTypeLegacyCount = await prisma.classType.count({
    where: {
      OR: legacyContainsFilter("imageUrl"),
    },
  });

  const learningProgramLegacyCount = await prisma.learningProgram.count({
    where: {
      OR: [
        ...legacyContainsFilter("picture1"),
        ...legacyContainsFilter("picture2"),
        ...legacyContainsFilter("picture3"),
      ],
    },
  });

  const learningCourseLegacyCount = await prisma.learningCourse.count({
    where: {
      OR: legacyContainsFilter("thumbnail"),
    },
  });

  return [
    { label: "MediaAsset.path", count: mediaAssetLegacyCount },
    { label: "User.image", count: userLegacyCount },
    { label: "ClassType.imageUrl", count: classTypeLegacyCount },
    { label: "LearningProgram.picture1|2|3", count: learningProgramLegacyCount },
    { label: "LearningCourse.thumbnail", count: learningCourseLegacyCount },
  ];
}

async function main(): Promise<void> {
  try {
    const runtimeResult = await verifyMediaRuntime();
    const counts = await countLegacyMediaPaths();
    const readiness = evaluateMediaHardCutoverReadiness(counts);

    console.log("[media-verify] uploadsDir", runtimeResult.uploadsDir);
    for (const row of counts) {
      console.log(`[media-verify] ${row.label}: ${row.count}`);
    }

    if (!readiness.ok) {
      for (const blocker of readiness.blockers) {
        console.error(`[media-verify] blocker: ${blocker}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log("[media-verify] ok");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (error: unknown) => {
  console.error("[media-verify] failed", error instanceof Error ? error.message : String(error));
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
