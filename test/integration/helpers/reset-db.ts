import { prisma } from "./db";

const RESET_LOCK_KEY = 7_243_511_909_211n;
const debugReset = process.env.DEBUG_TEST_DB_RESET === "1";

function logReset(stage: string, details?: Record<string, unknown>) {
  if (!debugReset) return;
  console.info(`[test-reset-db] ${stage}`, details ?? {});
}

function isRetryableResetError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("40P01")
    || message.toLowerCase().includes("deadlock detected")
    || message.includes("Unable to start a transaction in the given time")
    || message.includes("Server has closed the connection")
  );
}

async function refreshPrismaConnection() {
  try {
    await prisma.$disconnect();
  } catch {
    // Ignore disconnect failures when the underlying connection is already closed.
  }

  await prisma.$connect();
}

export async function resetDb() {
  const startedAt = Date.now();
  logReset("start");

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await prisma.$transaction(
        async (tx) => {
          logReset("lock_wait_start", { attempt });
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RESET_LOCK_KEY})`;
          logReset("lock_acquired", { elapsedMs: Date.now() - startedAt, attempt });

          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '30s'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '90s'`);

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

          await tx.emailTemplate.create({
            data: {
              templateKey: "booking.class-booked",
              name: "Booking Confirmation",
              category: "BOOKING",
              subjectTemplate: "You're booked for {{booking.classTitle}}",
              bodyTemplateJson: {
                blocks: [{ type: "paragraph", text: "Hello {{clientName}}," }],
              },
              contentSchemaVersion: 1,
              isActive: true,
            },
          });
        },
        {
          maxWait: 60_000,
          timeout: 120_000,
        },
      );
      logReset("done", { elapsedMs: Date.now() - startedAt, attempts: attempt });
      return;
    } catch (error) {
      if (!isRetryableResetError(error) || attempt === maxAttempts) {
        throw error;
      }
      logReset("retry", { attempt, reason: error instanceof Error ? error.message : String(error) });
      await refreshPrismaConnection();
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }

  logReset("done", { elapsedMs: Date.now() - startedAt, attempts: maxAttempts });
}
