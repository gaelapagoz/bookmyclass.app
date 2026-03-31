import fs from "node:fs";
import path from "node:path";

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

async function getTrendCoverage(databaseUrl: string): Promise<TrendCoverage> {
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
  }>(
    `
      SELECT
        (SELECT COUNT(DISTINCT DATE(s."createdAt"))
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%') AS session_days,
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
        (SELECT MIN(DATE(s."createdAt"))::text
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%') AS earliest_session_day,
        (SELECT MAX(DATE(s."createdAt"))::text
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%') AS latest_session_day,
        (SELECT COUNT(DISTINCT DATE(s."createdAt"))
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%'
           AND DATE(s."createdAt") >= CURRENT_DATE - INTERVAL '6 days') AS session_days_last_7,
        (SELECT COUNT(DISTINCT DATE(s."createdAt"))
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%'
           AND DATE(s."createdAt") >= CURRENT_DATE - INTERVAL '29 days') AS session_days_last_30,
        (SELECT COUNT(DISTINCT DATE(s."createdAt"))
         FROM "Session" s
         WHERE s."sessionToken" LIKE $1 || '-session-%'
           AND DATE(s."createdAt") >= CURRENT_DATE - INTERVAL '89 days') AS session_days_last_90
    `,
    [marker, markerEmail],
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
  };
}

function validate(coverage: TrendCoverage): string[] {
  const failures: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expectedLatest = today.toISOString().slice(0, 10);
  const expectedEarliest = new Date(today.getTime() - 99 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

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

  console.log(`Trend verify DB: ${sanitizeDatabaseUrl(databaseUrl)}`);
  const coverage = await getTrendCoverage(databaseUrl);

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

main().catch((error: unknown) => {
  console.error("verify-dashboard-trend-seed-db failed", error);
  process.exit(1);
});
