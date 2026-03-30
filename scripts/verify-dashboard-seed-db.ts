import fs from "node:fs";
import path from "node:path";

import { parse } from "dotenv";
import { Client } from "pg";

type DashboardCounts = {
  users: number;
  clients: number;
  sessions: number;
  bookings: number;
  orders: number;
  paidOrders: number;
  succeededPayments: number;
  activeOrExpiredSubscriptions: number;
  entitlements: number;
  validBookingsInPeriod: number;
  cancelledBookingsInPeriod: number;
  upcomingSessions: number;
  clientsWithMultiplePurchases: number;
  clientsWithBookings: number;
  seededTopClientsFound: number;
  seededTopClientsWithPurchases: number;
  seededTopClientsWithBookings: number;
  seededTeachersFound: number;
  seededClassesFound: number;
  seededAtRiskWithHistoricalBookings: number;
  seededAtRiskWithCurrentPeriodBookings: number;
};

function readEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = fs.readFileSync(filePath, "utf8");
    return parse(raw);
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

async function getDashboardCounts(databaseUrl: string): Promise<DashboardCounts> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const countsQuery = await client.query<{
    users: string;
    clients: string;
    sessions: string;
    bookings: string;
    orders: string;
    paid_orders: string;
    succeeded_payments: string;
    active_or_expired_subscriptions: string;
    entitlements: string;
    valid_bookings_in_period: string;
    cancelled_bookings_in_period: string;
    upcoming_sessions: string;
    clients_with_multiple_purchases: string;
    clients_with_bookings: string;
    seeded_top_clients_found: string;
    seeded_top_clients_with_purchases: string;
    seeded_top_clients_with_bookings: string;
    seeded_teachers_found: string;
    seeded_classes_found: string;
    seeded_at_risk_with_historical_bookings: string;
    seeded_at_risk_with_current_period_bookings: string;
  }>(`
    WITH top_clients AS (
      SELECT UNNEST(ARRAY['Katalin', 'Maja Simunic', 'Eline', 'Batool Dodin', 'Kriselda Deda']) AS name
    ),
    at_risk_clients AS (
      SELECT UNNEST(ARRAY['Engy Sawah', 'Nela O', 'Francesca', 'Nolwenn Bertrand', 'Svitlana Metelytsia']) AS name
    )
    SELECT
      (SELECT COUNT(*) FROM "User") AS users,
      (SELECT COUNT(*) FROM "User" WHERE role = 'CLIENT') AS clients,
      (SELECT COUNT(*) FROM "StudioSession") AS sessions,
      (SELECT COUNT(*) FROM "Booking") AS bookings,
      (SELECT COUNT(*) FROM "Order") AS orders,
      (SELECT COUNT(*) FROM "Order" o WHERE o.status = 'PAID') AS paid_orders,
      (SELECT COUNT(*) FROM "Payment" p WHERE p.status = 'SUCCEEDED') AS succeeded_payments,
      (
        SELECT COUNT(*)
        FROM "SubscriptionContract" sc
        WHERE sc.status IN ('ACTIVE', 'EXPIRED')
      ) AS active_or_expired_subscriptions,
      (SELECT COUNT(*) FROM "ClientEntitlement") AS entitlements,
      (
        SELECT COUNT(*)
        FROM "Booking" b
        WHERE b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
          AND b."bookedAt" >= NOW() - INTERVAL '60 days'
      ) AS valid_bookings_in_period,
      (
        SELECT COUNT(*)
        FROM "Booking" b
        WHERE b.status = 'CANCELLED'
          AND b."bookedAt" >= NOW() - INTERVAL '60 days'
      ) AS cancelled_bookings_in_period,
      (
        SELECT COUNT(*)
        FROM "StudioSession" s
        WHERE s."startsAt" > NOW()
      ) AS upcoming_sessions,
      (
        SELECT COUNT(*)
        FROM (
          SELECT o."clientId"
          FROM "Order" o
          WHERE o.status = 'PAID'
          GROUP BY o."clientId"
          HAVING COUNT(*) >= 2
        ) grouped
      ) AS clients_with_multiple_purchases,
      (
        SELECT COUNT(*)
        FROM (
          SELECT b."clientId"
          FROM "Booking" b
          WHERE b."clientId" IS NOT NULL
            AND b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
          GROUP BY b."clientId"
          HAVING COUNT(*) >= 1
        ) grouped
      ) AS clients_with_bookings,
      (
        SELECT COUNT(*)
        FROM "User" u
        WHERE u.name IN (SELECT name FROM top_clients)
      ) AS seeded_top_clients_found,
      (
        SELECT COUNT(DISTINCT u.id)
        FROM "User" u
        JOIN "Order" o ON o."clientId" = u.id AND o.status = 'PAID'
        WHERE u.name IN (SELECT name FROM top_clients)
      ) AS seeded_top_clients_with_purchases,
      (
        SELECT COUNT(DISTINCT u.id)
        FROM "User" u
        JOIN "Booking" b ON b."clientId" = u.id AND b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
        WHERE u.name IN (SELECT name FROM top_clients)
      ) AS seeded_top_clients_with_bookings,
      (
        SELECT COUNT(*)
        FROM "User" u
        WHERE u.name IN ('Orsi', 'Giulia Vago', 'Elisa', 'Ourania')
      ) AS seeded_teachers_found,
      (
        SELECT COUNT(*)
        FROM "ClassTemplate" ct
        WHERE ct.title IN (
          'Rocket Yoga',
          'Pilates with Props',
          'Vinyasa Yoga',
          'Functional Training TRX',
          'Stretch & Tone Pilates'
        )
      ) AS seeded_classes_found,
      (
        SELECT COUNT(DISTINCT u.id)
        FROM "User" u
        JOIN "Booking" b ON b."clientId" = u.id
          AND b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
          AND b."bookedAt" < DATE_TRUNC('month', NOW())
        WHERE u.name IN (SELECT name FROM at_risk_clients)
      ) AS seeded_at_risk_with_historical_bookings,
      (
        SELECT COUNT(DISTINCT u.id)
        FROM "User" u
        JOIN "Booking" b ON b."clientId" = u.id
          AND b.status IN ('CONFIRMED', 'COMPLETED', 'NO_SHOW')
          AND b."bookedAt" >= DATE_TRUNC('month', NOW())
        WHERE u.name IN (SELECT name FROM at_risk_clients)
      ) AS seeded_at_risk_with_current_period_bookings
  `);

  await client.end();
  const row = countsQuery.rows[0];
  if (!row) {
    throw new Error("No rows returned from dashboard count query");
  }

  return {
    users: Number(row.users),
    clients: Number(row.clients),
    sessions: Number(row.sessions),
    bookings: Number(row.bookings),
    orders: Number(row.orders),
    paidOrders: Number(row.paid_orders),
    succeededPayments: Number(row.succeeded_payments),
    activeOrExpiredSubscriptions: Number(row.active_or_expired_subscriptions),
    entitlements: Number(row.entitlements),
    validBookingsInPeriod: Number(row.valid_bookings_in_period),
    cancelledBookingsInPeriod: Number(row.cancelled_bookings_in_period),
    upcomingSessions: Number(row.upcoming_sessions),
    clientsWithMultiplePurchases: Number(row.clients_with_multiple_purchases),
    clientsWithBookings: Number(row.clients_with_bookings),
    seededTopClientsFound: Number(row.seeded_top_clients_found),
    seededTopClientsWithPurchases: Number(row.seeded_top_clients_with_purchases),
    seededTopClientsWithBookings: Number(row.seeded_top_clients_with_bookings),
    seededTeachersFound: Number(row.seeded_teachers_found),
    seededClassesFound: Number(row.seeded_classes_found),
    seededAtRiskWithHistoricalBookings: Number(row.seeded_at_risk_with_historical_bookings),
    seededAtRiskWithCurrentPeriodBookings: Number(row.seeded_at_risk_with_current_period_bookings),
  };
}

function printCounts(label: string, counts: DashboardCounts) {
  console.log(`\n${label}`);
  console.log(`- users: ${counts.users}`);
  console.log(`- clients: ${counts.clients}`);
  console.log(`- sessions: ${counts.sessions}`);
  console.log(`- bookings: ${counts.bookings}`);
  console.log(`- orders: ${counts.orders}`);
  console.log(`- paidOrders: ${counts.paidOrders}`);
  console.log(`- succeededPayments: ${counts.succeededPayments}`);
  console.log(`- activeOrExpiredSubscriptions: ${counts.activeOrExpiredSubscriptions}`);
  console.log(`- entitlements: ${counts.entitlements}`);
  console.log(`- validBookingsInPeriod (CONFIRMED/COMPLETED/NO_SHOW, 60d): ${counts.validBookingsInPeriod}`);
  console.log(`- cancelledBookingsInPeriod (CANCELLED, 60d): ${counts.cancelledBookingsInPeriod}`);
  console.log(`- upcomingSessions: ${counts.upcomingSessions}`);
  console.log(`- clientsWithMultiplePurchases (>=2 paid orders): ${counts.clientsWithMultiplePurchases}`);
  console.log(`- clientsWithBookings (>=1 valid booking): ${counts.clientsWithBookings}`);
  console.log(`- seededTopClientsFound (expected 5): ${counts.seededTopClientsFound}`);
  console.log(`- seededTopClientsWithPurchases (expected 5): ${counts.seededTopClientsWithPurchases}`);
  console.log(`- seededTopClientsWithBookings (expected 5): ${counts.seededTopClientsWithBookings}`);
  console.log(`- seededTeachersFound (expected 4): ${counts.seededTeachersFound}`);
  console.log(`- seededClassesFound (expected 5): ${counts.seededClassesFound}`);
  console.log(`- seededAtRiskWithHistoricalBookings (expected 5): ${counts.seededAtRiskWithHistoricalBookings}`);
  console.log(`- seededAtRiskWithCurrentPeriodBookings (expected 0): ${counts.seededAtRiskWithCurrentPeriodBookings}`);
}

function validateCounts(counts: DashboardCounts): string[] {
  const failures: string[] = [];

  if (counts.orders <= 0) {
    failures.push("orders must be > 0");
  }
  if (counts.paidOrders <= 0) {
    failures.push("paidOrders must be > 0");
  }
  if (counts.succeededPayments <= 0) {
    failures.push("succeededPayments must be > 0");
  }
  if (counts.activeOrExpiredSubscriptions <= 0) {
    failures.push("activeOrExpiredSubscriptions must be > 0");
  }
  if (counts.entitlements <= 0) {
    failures.push("entitlements must be > 0");
  }
  if (counts.bookings <= 0) {
    failures.push("bookings must be > 0");
  }
  if (counts.cancelledBookingsInPeriod <= 0) {
    failures.push("cancelledBookingsInPeriod must be > 0");
  }
  if (counts.clientsWithMultiplePurchases < 5) {
    failures.push("clientsWithMultiplePurchases must be >= 5");
  }
  if (counts.clientsWithBookings < 5) {
    failures.push("clientsWithBookings must be >= 5");
  }
  if (counts.seededTopClientsFound < 5) {
    failures.push("seededTopClientsFound must be >= 5");
  }
  if (counts.seededTopClientsWithPurchases < 5) {
    failures.push("seededTopClientsWithPurchases must be >= 5");
  }
  if (counts.seededTopClientsWithBookings < 5) {
    failures.push("seededTopClientsWithBookings must be >= 5");
  }
  if (counts.seededTeachersFound < 4) {
    failures.push("seededTeachersFound must be >= 4");
  }
  if (counts.seededClassesFound < 5) {
    failures.push("seededClassesFound must be >= 5");
  }
  if (counts.seededAtRiskWithHistoricalBookings < 5) {
    failures.push("seededAtRiskWithHistoricalBookings must be >= 5");
  }
  if (counts.seededAtRiskWithCurrentPeriodBookings !== 0) {
    failures.push("seededAtRiskWithCurrentPeriodBookings must be 0");
  }

  return failures;
}

async function main() {
  const root = process.cwd();
  const envPath = path.join(root, ".env");
  const envLocalPath = path.join(root, ".env.local");

  const envValues = readEnvFile(envPath);
  const envLocalValues = readEnvFile(envLocalPath);

  const seedDatabaseUrl = envValues.DATABASE_URL ?? process.env.DATABASE_URL;
  const appDatabaseUrl =
    envLocalValues.DATABASE_URL ?? process.env.DATABASE_URL ?? envValues.DATABASE_URL;

  if (!seedDatabaseUrl || !appDatabaseUrl) {
    console.error("DATABASE_URL missing in .env and/or .env.local");
    process.exit(1);
  }

  console.log("Database targets (sanitized):");
  console.log(`- seed (.env): ${sanitizeDatabaseUrl(seedDatabaseUrl)}`);
  console.log(`- app (.env.local -> .env): ${sanitizeDatabaseUrl(appDatabaseUrl)}`);
  console.log(`- urlsMatch: ${seedDatabaseUrl === appDatabaseUrl}`);

  const [seedCounts, appCounts] = await Promise.all([
    getDashboardCounts(seedDatabaseUrl),
    getDashboardCounts(appDatabaseUrl),
  ]);

  printCounts("Seed DB counts", seedCounts);
  printCounts("App DB counts", appCounts);

  if (seedDatabaseUrl !== appDatabaseUrl) {
    console.log("\nRoot-cause candidate: app and seed DATABASE_URL are different.");
    process.exit(2);
  }

  if (appCounts.bookings === 0 || appCounts.sessions === 0) {
    console.log("\nRoot-cause candidate: database was reset after seed or seed did not run.");
    process.exit(3);
  }

  const failures = validateCounts(appCounts);
  if (failures.length > 0) {
    console.log("\nRoot-cause confirmed: deterministic dashboard commercial seed dataset is incomplete in active DB.");
    for (const failure of failures) {
      console.log(`- ${failure}`);
    }
    console.log("Run prisma seed after DB reset using the same DATABASE_URL used by the app.");
    process.exit(4);
  }

  console.log(
    "\nVerification complete: app and seed point to same DB and deterministic dashboard commercial data is present.",
  );
}

main().catch((error: unknown) => {
  console.error("verify-dashboard-seed-db failed", error);
  process.exit(1);
});
