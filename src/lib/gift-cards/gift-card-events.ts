import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

type GiftCardAlertEventInput = {
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

export async function emitGiftCardAlertEvent(input: GiftCardAlertEventInput): Promise<void> {
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
        gift_card_event: input.eventName,
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
        gift_card_event: input.eventName,
        entity_type: input.entityType,
      },
      extra: {
        entityId: input.entityId,
        metadata,
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      actionType: input.eventName,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata,
    },
  });
}
