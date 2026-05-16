/**
 * Dashboard server verify trend seed db
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Mutating operation. Review target variables before running.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/dashboard-server-verify-trend-seed-db.ts
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parse } from "dotenv";
import { Client } from "pg";

type TrendCoverage = {
  sessionDays: number;
  orderDays: number;
  paymentDays: number;
  bookingDays: number;
  cancellationDays: number;
  earliestSessionDay: string | null;
  latestSessionDay: string | null;
  sessionDaysLast7: number;
  sessionDaysLast30: number;
  sessionDaysLast90: number;
  referenceDay: string | null;
};

function readEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    return parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function sanitizeDatabaseUrl(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "invalid DATABASE_URL";
  }
}

function parseDateOnlyUtc(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function addUtcDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function parseAsOfArgument(argv: string[]): string | null {
  const prefix = "--as-of=";
  const raw = argv.find((arg) => arg.startsWith(prefix));
  if (!raw) {
    return null;
  }

  const value = raw.slice(prefix.length);
  if (!parseDateOnlyUtc(value)) {
    throw new Error(`Invalid --as-of value "${value}". Expected YYYY-MM-DD.`);
  }

  return value;
}

async function getTrendCoverage(databaseUrl: string, asOf: string | null): Promise<TrendCoverage> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const marker = "seed-demo-trend";
  const markerEmail = "seed-demo-trend@yogapilatesfitness.local";
  const result = await client.query<{
    session_days: string;
    order_days: string;
    payment_days: string;
    booking_days: string;
    cancellation_days: string;
    earliest_session_day: string | null;
    latest_session_day: string | null;
    session_days_last_7: string;
    session_days_last_30: string;
    session_days_last_90: string;
    reference_day: string | null;
  }>(
    `
      WITH trend_sessions AS (
        SELECT DATE(s."createdAt") AS day
        FROM "Session" s
        WHERE s."sessionToken" LIKE $1 || '-session-%'
      ),
      trend_bounds AS (
        SELECT MIN(day) AS earliest_day, MAX(day) AS latest_day
        FROM trend_sessions
      ),
      trend_reference AS (
        SELECT COALESCE($3::date, (SELECT latest_day FROM trend_bounds)) AS as_of_day
      )
      SELECT
        (SELECT COUNT(DISTINCT day) FROM trend_sessions) AS session_days,
        (SELECT COUNT(DISTINCT DATE(o."placedAt"))
         FROM "Order" o
         WHERE o.notes LIKE $1 || '-order-%') AS order_days,
        (SELECT COUNT(DISTINCT DATE(p."createdAt"))
         FROM "Payment" p
         WHERE p."providerReference" LIKE $1 || '-payment-%') AS payment_days,
        (SELECT COUNT(DISTINCT DATE(b."bookedAt"))
         FROM "Booking" b
         WHERE b."customerEmail" = $2
           AND b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')) AS booking_days,
        (SELECT COUNT(DISTINCT DATE(b."cancelledAt"))
         FROM "Booking" b
         WHERE b."customerEmail" = $2
           AND b.status = 'CANCELLED'
           AND b."cancelledAt" IS NOT NULL) AS cancellation_days,
        (SELECT earliest_day::text FROM trend_bounds) AS earliest_session_day,
        (SELECT latest_day::text FROM trend_bounds) AS latest_session_day,
        (SELECT COUNT(DISTINCT day)
         FROM trend_sessions
         WHERE day >= (SELECT as_of_day FROM trend_reference) - INTERVAL '6 days') AS session_days_last_7,
        (SELECT COUNT(DISTINCT day)
         FROM trend_sessions
         WHERE day >= (SELECT as_of_day FROM trend_reference) - INTERVAL '29 days') AS session_days_last_30,
        (SELECT COUNT(DISTINCT day)
         FROM trend_sessions
         WHERE day >= (SELECT as_of_day FROM trend_reference) - INTERVAL '89 days') AS session_days_last_90,
        (SELECT as_of_day::text FROM trend_reference) AS reference_day
    `,
    [marker, markerEmail, asOf],
  );

  await client.end();
  const row = result.rows[0];
  if (!row) {
    throw new Error("No trend coverage rows returned.");
  }

  return {
    sessionDays: Number(row.session_days),
    orderDays: Number(row.order_days),
    paymentDays: Number(row.payment_days),
    bookingDays: Number(row.booking_days),
    cancellationDays: Number(row.cancellation_days),
    earliestSessionDay: row.earliest_session_day,
    latestSessionDay: row.latest_session_day,
    sessionDaysLast7: Number(row.session_days_last_7),
    sessionDaysLast30: Number(row.session_days_last_30),
    sessionDaysLast90: Number(row.session_days_last_90),
    referenceDay: row.reference_day,
  };
}

export function validate(coverage: TrendCoverage): string[] {
  const failures: string[] = [];
  const referenceDate = coverage.referenceDay ? parseDateOnlyUtc(coverage.referenceDay) : null;
  if (!referenceDate) {
    failures.push("referenceDay is missing or invalid");
    return failures;
  }

  const expectedLatest = coverage.referenceDay;
  const expectedEarliest = addUtcDays(referenceDate, -99).toISOString().slice(0, 10);

  if (coverage.sessionDays !== 100) failures.push(`sessionDays expected 100, got ${coverage.sessionDays}`);
  if (coverage.orderDays !== 100) failures.push(`orderDays expected 100, got ${coverage.orderDays}`);
  if (coverage.paymentDays !== 100) failures.push(`paymentDays expected 100, got ${coverage.paymentDays}`);
  if (coverage.bookingDays !== 100) failures.push(`bookingDays expected 100, got ${coverage.bookingDays}`);
  if (coverage.cancellationDays !== 100) failures.push(`cancellationDays expected 100, got ${coverage.cancellationDays}`);
  if (coverage.earliestSessionDay !== expectedEarliest) {
    failures.push(`earliestSessionDay expected ${expectedEarliest}, got ${coverage.earliestSessionDay ?? "null"}`);
  }
  if (coverage.latestSessionDay !== expectedLatest) {
    failures.push(`latestSessionDay expected ${expectedLatest}, got ${coverage.latestSessionDay ?? "null"}`);
  }
  if (coverage.sessionDaysLast7 < 7) failures.push(`sessionDaysLast7 expected >= 7, got ${coverage.sessionDaysLast7}`);
  if (coverage.sessionDaysLast30 < 30) failures.push(`sessionDaysLast30 expected >= 30, got ${coverage.sessionDaysLast30}`);
  if (coverage.sessionDaysLast90 < 90) failures.push(`sessionDaysLast90 expected >= 90, got ${coverage.sessionDaysLast90}`);

  return failures;
}

async function main() {
  const root = process.cwd();
  const envPath = path.join(root, ".env");
  const envLocalPath = path.join(root, ".env.local");
  const envValues = readEnvFile(envPath);
  const envLocalValues = readEnvFile(envLocalPath);
  const databaseUrl = envLocalValues.DATABASE_URL ?? process.env.DATABASE_URL ?? envValues.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL missing in .env/.env.local");
    process.exit(1);
  }

  const asOf = parseAsOfArgument(process.argv.slice(2));

  console.log(`Trend verify DB: ${sanitizeDatabaseUrl(databaseUrl)}`);
  if (asOf) {
    console.log(`Trend verify reference (--as-of): ${asOf}`);
  }

  const coverage = await getTrendCoverage(databaseUrl, asOf);

  console.log("Trend marker coverage:");
  console.log(`- sessionDays: ${coverage.sessionDays}`);
  console.log(`- orderDays: ${coverage.orderDays}`);
  console.log(`- paymentDays: ${coverage.paymentDays}`);
  console.log(`- bookingDays: ${coverage.bookingDays}`);
  console.log(`- cancellationDays: ${coverage.cancellationDays}`);
  console.log(`- earliestSessionDay: ${coverage.earliestSessionDay}`);
  console.log(`- latestSessionDay: ${coverage.latestSessionDay}`);
  console.log(`- sessionDaysLast7: ${coverage.sessionDaysLast7}`);
  console.log(`- sessionDaysLast30: ${coverage.sessionDaysLast30}`);
  console.log(`- sessionDaysLast90: ${coverage.sessionDaysLast90}`);
  console.log(`- referenceDay: ${coverage.referenceDay}`);

  const failures = validate(coverage);
  if (failures.length > 0) {
    console.log("Trend seed verification failed:");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    process.exit(2);
  }

  console.log("Trend seed verification passed.");
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error("verify-dashboard-trend-seed-db failed", error);
    process.exit(1);
  });
}

