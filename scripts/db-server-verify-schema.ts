/**
 * Db server verify schema
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Read-only checks by default.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/db-server-verify-schema.ts
 */
import fs from "node:fs";
import path from "node:path";

import { parse } from "dotenv";
import { Client } from "pg";

const REQUIRED_TABLES = [
  "GiftCardWallet",
  "GiftCardLedgerEntry",
  "GiftCardRedemption",
  "GiftCardReconciliationCase",
  "GiftCardCode",
];

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

function sanitizeUrl(databaseUrl: string): string {
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

async function checkTables(databaseUrl: string): Promise<{ missing: string[]; present: string[] }> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    );

    const present = result.rows.map((r) => r.table_name);
    const missing = REQUIRED_TABLES.filter((t) => !present.includes(t));
    return { present, missing };
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const envLocal = readEnvFile(path.join(root, ".env.local"));
  const envBase = readEnvFile(path.join(root, ".env"));

  const databaseUrl =
    envLocal.DATABASE_URL ?? process.env.DATABASE_URL ?? envBase.DATABASE_URL;

  if (!databaseUrl) {
    console.error("[verify-db-schema] DATABASE_URL not found in .env.local, .env, or environment.");
    process.exit(1);
  }

  console.log(`[verify-db-schema] Checking schema at: ${sanitizeUrl(databaseUrl)}`);

  let result: { missing: string[]; present: string[] };
  try {
    result = await checkTables(databaseUrl);
  } catch (error) {
    console.error("[verify-db-schema] Failed to connect to database:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (result.present.length > 0) {
    console.log(`[verify-db-schema] Present tables: ${result.present.join(", ")}`);
  }

  if (result.missing.length > 0) {
    console.error(`[verify-db-schema] FAIL: Missing required Store/Gift Card tables: ${result.missing.join(", ")}`);
    console.error("[verify-db-schema] The Store/Gift Card schema has not been migrated.");
    console.error("[verify-db-schema] Fix: run the following commands from the project root:");
    console.error("    npx prisma migrate deploy");
    console.error("    npx prisma generate");
    console.error("[verify-db-schema] Or, for local dev with schema changes:");
    console.error("    npx prisma migrate dev");
    console.error("    npx prisma generate");
    process.exit(1);
  }

  console.log("[verify-db-schema] All required Store/Gift Card tables are present. Schema OK.");
}

main().catch((error: unknown) => {
  console.error("[verify-db-schema] Unexpected error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
