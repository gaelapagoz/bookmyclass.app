import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const CATALOG_CORE_IMPORT = "@/lib/admin/admin-catalog-core-service";
const SCAN_ROOTS = [
  join(process.cwd(), "src", "app", "admin"),
  join(process.cwd(), "src", "lib", "admin"),
  join(process.cwd(), "src", "lib", "teacher"),
  join(process.cwd(), "src", "components", "admin"),
];

const FORBIDDEN_SYMBOLS = [
  "AdminSession",
  "AdminBooking",
  "AdminUser",
  "AdminPeriod",
  "AdminMetricCard",
  "AdminMetricKey",
  "DashboardMetricKey",
  "DashboardTrendPoint",
  "AdminDashboardInsights",
  "TopClassSessionItem",
  "TopClientItem",
  "AtRiskClientItem",
  "StaffPerformanceItem",
  "getAdminDashboardInsights",
  "getOperationalMetricCards",
  "getDashboardTrendData",
  "createAdminSession",
  "createAdminRecurringSessions",
  "updateAdminSession",
  "getAdminSessionsData",
  "getAdminSessionById",
  "getAdminSessionOptions",
  "addSessionAttendeeByManager",
  "removeSessionAttendeeByManager",
  "getBookings",
  "getAdminBookingsData",
  "createAdminUser",
  "updateAdminUser",
  "updateAdminTeacherImage",
  "adjustAdminClientCredits",
  "cancelAdminClientMembership",
  "bulkAddClientMarketingSegments",
  "bulkRemoveClientMarketingSegments",
  "bulkSetClientMarketingSubscriptionStatus",
  "getAdminUsersData",
  "getAdminUserById",
  "getAdminUsersGroupedPageData",
  "getAdminClientActivityData",
  "getAdminClientStats",
  "getAdminAdminsPageData",
  "getAdminTeachersPageData",
  "getAdminClientsPageData",
  "listAdminMarketingSegmentOptions",
] as const;

function listSourceFiles(root: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(root);
  for (const entry of entries) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      results.push(...listSourceFiles(path));
      continue;
    }
    if (path.endsWith(".ts") || path.endsWith(".tsx")) {
      results.push(path);
    }
  }
  return results;
}

function extractCatalogCoreImports(source: string): string[] {
  const imported: string[] = [];
  const statements = source.split(";");
  for (const statement of statements) {
    if (!statement.includes(CATALOG_CORE_IMPORT)) {
      continue;
    }
    const trimmed = statement.trim();
    if (!trimmed.startsWith("import")) {
      continue;
    }
    const blockStart = trimmed.indexOf("{");
    const blockEnd = trimmed.indexOf("}");
    if (blockStart === -1 || blockEnd === -1 || blockEnd <= blockStart) {
      continue;
    }
    const block = trimmed.slice(blockStart + 1, blockEnd);
    const symbols = block
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((symbol) => symbol.replace(/\s+as\s+.+$/, ""));
    imported.push(...symbols);
  }
  return imported;
}

function isForbiddenSymbol(symbol: string): boolean {
  return FORBIDDEN_SYMBOLS.some((forbidden) => symbol === forbidden || symbol.startsWith(forbidden));
}

describe("admin import boundaries", () => {
  it("prevents session/booking/user/analytics symbols from admin-catalog-core-service in production admin code", () => {
    const violations: Array<{ file: string; symbol: string }> = [];

    for (const root of SCAN_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const source = readFileSync(file, "utf8");
        if (!source.includes(CATALOG_CORE_IMPORT)) {
          continue;
        }
        const importedSymbols = extractCatalogCoreImports(source);
        for (const symbol of importedSymbols) {
          if (isForbiddenSymbol(symbol)) {
            violations.push({ file, symbol });
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
