/**
 * Media server backfill uploads
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Defaults to dry-run.
 * - Use --apply to copy files and mutate DB paths.
 *
 * Usage:
 *   tsx scripts/media-server-backfill-uploads.ts --dry-run
 *   tsx scripts/media-server-backfill-uploads.ts --apply
 */
import { PrismaClient } from "@prisma/client";

import { runMediaBackfill } from "../src/lib/media/media-backfill-service";

const prisma = new PrismaClient();

async function main() {
  const hasApply = process.argv.includes("--apply");
  const hasDryRun = process.argv.includes("--dry-run");
  const apply = hasApply && !hasDryRun;
  const result = await runMediaBackfill({
    prisma,
    apply,
  });

  console.log("[media-backfill] mode", result.mode);
  console.log("[media-backfill] uploadsDir", result.uploadsDir);
  console.log("[media-backfill] summary", result.summary);

  for (const candidate of result.candidates) {
    const state = result.existingTargets.some((existing) => sameCandidate(existing, candidate))
      ? "already-copied"
      : result.missingSources.some((missing) => sameCandidate(missing, candidate))
        ? "missing-source"
        : "pending";
    console.log("[media-backfill] candidate", {
      state,
      entity: candidate.entity,
      id: candidate.id,
      field: candidate.field,
      fromPath: candidate.fromPath,
      toPath: candidate.toPath,
    });
  }

  if (!result.mode || result.mode === "dry-run") {
    console.log("[media-backfill] dry-run only. Re-run with --apply to copy files and update DB paths.");
    return;
  }

  for (const candidate of result.applied) {
    console.log("[media-backfill] applied", {
      entity: candidate.entity,
      id: candidate.id,
      field: candidate.field,
      toPath: candidate.toPath,
    });
  }
}

function sameCandidate(
  left: { readonly entity: string; readonly id: string; readonly field: string; readonly fromPath: string },
  right: { readonly entity: string; readonly id: string; readonly field: string; readonly fromPath: string },
): boolean {
  return left.entity === right.entity && left.id === right.id && left.field === right.field && left.fromPath === right.fromPath;
}

main()
  .catch((error) => {
    console.error("[media-backfill] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
