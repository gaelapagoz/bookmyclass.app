import { prisma } from "./db";

const RESET_LOCK_KEY = 7_243_511_909_211n;
const debugReset = process.env.DEBUG_TEST_DB_RESET === "1";

function logReset(stage: string, details?: Record<string, unknown>) {
  if (!debugReset) return;
  console.info(`[test-reset-db] ${stage}`, details ?? {});
}

export async function resetDb() {
  const startedAt = Date.now();
  logReset("start");

  await prisma.$transaction(
    async (tx) => {
      logReset("lock_wait_start");
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESET_LOCK_KEY})`;
      logReset("lock_acquired", { elapsedMs: Date.now() - startedAt });

      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '15s'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '45s'`);

      await tx.$executeRawUnsafe(`
        DO $$
        DECLARE
          stmt text;
        BEGIN
          SELECT 'TRUNCATE TABLE '
            || string_agg(format('%I.%I', schemaname, tablename), ', ')
            || ' RESTART IDENTITY CASCADE'
          INTO stmt
          FROM pg_tables
          WHERE schemaname = 'public'
            AND tablename <> '_prisma_migrations';

          IF stmt IS NOT NULL THEN
            EXECUTE stmt;
          END IF;
        END $$;
      `);
    },
    {
      maxWait: 20_000,
      timeout: 60_000,
    },
  );

  logReset("done", { elapsedMs: Date.now() - startedAt });
}
