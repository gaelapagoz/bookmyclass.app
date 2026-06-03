import * as Sentry from "@sentry/nextjs";
import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/lib/db";

type AuditLogWriter = Pick<PrismaClient | Prisma.TransactionClient, "auditLog">;

type CouponAlertEventInput = {
  readonly eventName: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly metadata?: Prisma.InputJsonObject;
  readonly error?: unknown;
};

function serializeError(error: unknown): Prisma.InputJsonObject | undefined {
  if (!error) {
    return undefined;
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return { message: String(error) };
}

export async function emitCouponAlertEvent(
  input: CouponAlertEventInput,
  db: AuditLogWriter = prisma,
): Promise<void> {
  if (input.entityId) {
    const existing = await db.auditLog.findFirst({
      where: {
        actionType: input.eventName,
        entityType: input.entityType,
        entityId: input.entityId,
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }
  }

  const errorMetadata = serializeError(input.error);
  const metadata: Prisma.InputJsonObject = {
    ...(input.metadata ?? {}),
    ...(errorMetadata ? { error: errorMetadata } : {}),
  };

  console.error(`[${input.eventName}]`, {
    entityType: input.entityType,
    entityId: input.entityId,
    metadata,
  });

  if (input.error) {
    Sentry.captureException(input.error, {
      tags: {
        coupon_event: input.eventName,
        entity_type: input.entityType,
      },
      extra: {
        entityId: input.entityId,
        metadata,
      },
    });
  } else if (typeof Sentry.captureMessage === "function") {
    Sentry.captureMessage(input.eventName, {
      level: "error",
      tags: {
        coupon_event: input.eventName,
        entity_type: input.entityType,
      },
      extra: {
        entityId: input.entityId,
        metadata,
      },
    });
  }

  await db.auditLog.create({
    data: {
      actionType: input.eventName,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata,
    },
  });
}
