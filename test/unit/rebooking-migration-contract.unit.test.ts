import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ACTIVE_BOOKING_INDEX_SQL = `CREATE UNIQUE INDEX "Booking_active_client_session_unique"
ON "Booking" ("clientId", "studioSessionId")
WHERE "status" IN ('PENDING', 'CONFIRMED');`;

const DUPLICATE_ACTIVE_BOOKING_AUDIT_SQL = `SELECT "clientId", "studioSessionId", COUNT(*)
FROM "Booking"
WHERE "status" IN ('PENDING', 'CONFIRMED')
GROUP BY "clientId", "studioSessionId"
HAVING COUNT(*) > 1;`;

function readRepoFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function normalizeBlock(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function sqlBlocks(markdown: string) {
  return [...markdown.matchAll(/```sql\r?\n([\s\S]*?)\r?\n```/g)].map((match) => normalizeBlock(match[1]));
}

function prismaModelBlock(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
  return match?.[0] ?? "";
}

describe("rebooking migration contract", () => {
  it("documents the exact partial unique index and Prisma ownership limitation", () => {
    const domainRules = readRepoFile("docs/10_02_domain_rules.md");
    const releaseProcess = readRepoFile("docs/40_03_release_process.md");
    const roadmap = readRepoFile(".roadmap/0_bug_fixes.md");

    for (const document of [domainRules, releaseProcess, roadmap]) {
      expect(sqlBlocks(document)).toContain(ACTIVE_BOOKING_INDEX_SQL);
    }
    expect(domainRules).toContain("Prisma cannot fully represent the PostgreSQL partial unique index");
    expect(domainRules).toContain("Do not reintroduce broad `@@unique([clientId, studioSessionId])`");
  });

  it("documents the production duplicate-active-booking audit and stop condition", () => {
    const domainRules = readRepoFile("docs/10_02_domain_rules.md");
    const releaseProcess = readRepoFile("docs/40_03_release_process.md");
    const roadmap = readRepoFile(".roadmap/0_bug_fixes.md");

    for (const document of [domainRules, releaseProcess, roadmap]) {
      expect(sqlBlocks(document)).toContain(DUPLICATE_ACTIVE_BOOKING_AUDIT_SQL);
    }
    expect(releaseProcess).toContain("Expected result: 0 rows");
    expect(releaseProcess).toContain("Stop the deploy");
    expect(releaseProcess).toContain("Do not run the migration");
  });

  it("documents rollback and booking-history preservation rules", () => {
    const releaseProcess = readRepoFile("docs/40_03_release_process.md");

    expect(releaseProcess).toContain(
      "Rollback may recreate the original broad unique constraint only if the database",
    );
    expect(releaseProcess).toContain("Never delete booking");
    expect(releaseProcess).toContain("history automatically during rollback");
  });

  it("resolves the Phase 3 BookingStatus contract in schema and migration", () => {
    const domainRules = readRepoFile("docs/10_02_domain_rules.md");
    const roadmap = readRepoFile(".roadmap/0_bug_fixes.md");
    const schema = readRepoFile("prisma/schema.prisma");
    const migration = readRepoFile("prisma/migrations/20260501090000_booking_active_partial_index/migration.sql");
    const bookingModel = prismaModelBlock(schema, "Booking");

    expect(schema).toContain("enum BookingStatus");
    expect(schema).toContain("  EXPIRED");
    expect(bookingModel).not.toContain("@@unique([clientId, studioSessionId])");
    expect(migration).toContain("ALTER TYPE \"BookingStatus\" ADD VALUE IF NOT EXISTS 'EXPIRED';");
    expect(migration).toContain("DROP INDEX IF EXISTS \"Booking_clientId_studioSessionId_key\"");
    expect(migration).toContain(ACTIVE_BOOKING_INDEX_SQL);
    expect(migration).toContain("Prisma cannot fully represent this PostgreSQL partial unique index");
    expect(domainRules).toContain("Phase 3 schema migration adds `BookingStatus.EXPIRED`");
    expect(domainRules).toContain("Phase 3 schema migration resolves the `EXPIRED` status contract");
    expect(domainRules).toContain("Expired-draft behavior must use `BookingStatus.EXPIRED`");
    expect(domainRules).toContain("Lifecycle target: Draft -> Payment -> Confirmed OR Expired");
    expect(domainRules).not.toContain("pre-Phase-3 placeholder");
    expect(roadmap).toContain("must not be included in the active partial index");
  });

  it("documents broad client-session uniqueness only as forbidden or pending removal", () => {
    const domainRules = readRepoFile("docs/10_02_domain_rules.md");
    const releaseProcess = readRepoFile("docs/40_03_release_process.md");
    const roadmap = readRepoFile(".roadmap/0_bug_fixes.md");

    expect(domainRules).toContain("Do not reintroduce broad `@@unique([clientId, studioSessionId])`");
    expect(releaseProcess).toContain("broad `@@unique([clientId, studioSessionId])` must not be");
    expect(roadmap).toContain("not reintroduce broad `@@unique([clientId, studioSessionId])`");
    expect(roadmap).toContain("Phase 3.2 will drop this and replace with the partial index");
  });
});
