import { EmailAutomationAttemptStatus, EmailAutomationEventStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/db";

const enqueueInputSchema = z.object({
  templateKey: z.string().trim().min(1),
  recipientEmail: z.string().trim().email(),
  payloadJson: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().trim().min(1),
  availableAt: z.coerce.date().optional(),
  maxAttempts: z.coerce.number().int().min(1).max(20).optional(),
});

const leaseInputSchema = z.object({
  leaseOwner: z.string().trim().min(1),
  maxEvents: z.coerce.number().int().min(1).max(100),
  leaseMs: z.coerce.number().int().min(1_000).max(300_000),
  now: z.coerce.date().optional(),
});

const finalizeInputSchema = z.object({
  eventId: z.string().trim().min(1),
  leaseOwner: z.string().trim().min(1),
  sent: z.boolean(),
  errorMessage: z.string().trim().max(5_000).optional(),
  forceDeadLetter: z.boolean().optional(),
  now: z.coerce.date().optional(),
  retryBackoffMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
});

const heartbeatInputSchema = z.object({
  workerId: z.string().trim().min(1),
  activeLeaseCount: z.coerce.number().int().min(0).max(10_000),
  metadataJson: z.record(z.string(), z.unknown()).optional(),
  now: z.coerce.date().optional(),
});

function shouldLogEmailOutboxActivity(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";
}

export async function enqueueEmailAutomationEvent(input: z.input<typeof enqueueInputSchema>) {
  const parsed = enqueueInputSchema.parse(input);
  const template = await prisma.emailTemplate.findUnique({
    where: { templateKey: parsed.templateKey },
    select: { id: true, isActive: true },
  });

  if (!template) {
    throw new Error(`Unknown email template key: ${parsed.templateKey}`);
  }

  if (!template.isActive) {
    if (shouldLogEmailOutboxActivity()) {
      console.info("[email-outbox] skipped enqueue for inactive template", {
        idempotencyKey: parsed.idempotencyKey,
        recipientEmail: parsed.recipientEmail.toLowerCase(),
        templateKey: parsed.templateKey,
      });
    }
    return null;
  }

  try {
    const created = await prisma.emailAutomationEvent.create({
      data: {
        templateId: template.id,
        recipientEmail: parsed.recipientEmail.toLowerCase(),
        payloadJson: parsed.payloadJson as Prisma.InputJsonValue,
        idempotencyKey: parsed.idempotencyKey,
        availableAt: parsed.availableAt ?? new Date(),
        maxAttempts: parsed.maxAttempts ?? 5,
        status: EmailAutomationEventStatus.PENDING,
      },
    });
    if (shouldLogEmailOutboxActivity()) {
      console.info("[email-outbox] enqueued event", {
        eventId: created.id,
        idempotencyKey: created.idempotencyKey,
        recipientEmail: created.recipientEmail,
        templateKey: parsed.templateKey,
      });
    }
    return created;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.emailAutomationEvent.findUnique({
        where: { idempotencyKey: parsed.idempotencyKey },
      });
      if (existing) {
        if (shouldLogEmailOutboxActivity()) {
          console.info("[email-outbox] reused existing event", {
            eventId: existing.id,
            idempotencyKey: existing.idempotencyKey,
            recipientEmail: existing.recipientEmail,
            templateKey: parsed.templateKey,
          });
        }
        return existing;
      }
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new Error(`Unknown email template key: ${parsed.templateKey}`);
    }
    throw error;
  }
}

export async function acquireEmailAutomationLease(input: z.input<typeof leaseInputSchema>) {
  const parsed = leaseInputSchema.parse(input);
  const now = parsed.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + parsed.leaseMs);

  return prisma.$transaction(async (tx) => {
    const candidates = await tx.emailAutomationEvent.findMany({
      where: {
        status: {
          in: [EmailAutomationEventStatus.PENDING, EmailAutomationEventStatus.LEASED],
        },
        availableAt: { lte: now },
        OR: [
          { status: EmailAutomationEventStatus.PENDING },
          { status: EmailAutomationEventStatus.LEASED, leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ availableAt: "asc" }, { createdAt: "asc" }],
      take: parsed.maxEvents,
      select: { id: true, attempts: true, maxAttempts: true },
    });

    const leasedIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.attempts >= candidate.maxAttempts) {
        continue;
      }
      const updated = await tx.emailAutomationEvent.updateMany({
        where: {
          id: candidate.id,
          availableAt: { lte: now },
          OR: [
            { status: EmailAutomationEventStatus.PENDING },
            { status: EmailAutomationEventStatus.LEASED, leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: EmailAutomationEventStatus.LEASED,
          leaseOwner: parsed.leaseOwner,
          leasedAt: now,
          leaseExpiresAt,
        },
      });
      if (updated.count === 1) {
        leasedIds.push(candidate.id);
      }
    }

    if (leasedIds.length === 0) {
      return [];
    }

    return tx.emailAutomationEvent.findMany({
      where: { id: { in: leasedIds } },
      orderBy: [{ leasedAt: "asc" }, { createdAt: "asc" }],
    });
  });
}

export async function finalizeEmailAutomationLease(input: z.input<typeof finalizeInputSchema>) {
  const parsed = finalizeInputSchema.parse(input);
  const now = parsed.now ?? new Date();
  const retryBackoffMs = parsed.retryBackoffMs ?? 0;

  return prisma.$transaction(async (tx) => {
    const leased = await tx.emailAutomationEvent.findFirst({
      where: {
        id: parsed.eventId,
        status: EmailAutomationEventStatus.LEASED,
        leaseOwner: parsed.leaseOwner,
      },
    });
    if (!leased) {
      return null;
    }

    const nextAttempts = leased.attempts + 1;
    const reachedMax = !parsed.sent && (parsed.forceDeadLetter || nextAttempts >= leased.maxAttempts);
    const nextStatus = parsed.sent
      ? EmailAutomationEventStatus.SENT
      : reachedMax
        ? EmailAutomationEventStatus.DEAD_LETTER
        : EmailAutomationEventStatus.PENDING;

    const nextAvailableAt = parsed.sent
      ? leased.availableAt
      : new Date(now.getTime() + retryBackoffMs);

    const updatedEvent = await tx.emailAutomationEvent.update({
      where: { id: leased.id },
      data: {
        status: nextStatus,
        attempts: nextAttempts,
        sentAt: parsed.sent ? now : null,
        deadLetteredAt: reachedMax ? now : null,
        lastError: parsed.sent ? null : parsed.errorMessage ?? "Email delivery failed",
        leaseOwner: null,
        leasedAt: null,
        leaseExpiresAt: null,
        availableAt: nextAvailableAt,
      },
    });

    await tx.emailAutomationAttempt.create({
      data: {
        eventId: leased.id,
        status: parsed.sent ? EmailAutomationAttemptStatus.SUCCEEDED : EmailAutomationAttemptStatus.FAILED,
        leaseOwner: parsed.leaseOwner,
        startedAt: leased.leasedAt ?? now,
        finishedAt: now,
        errorMessage: parsed.sent ? null : parsed.errorMessage ?? null,
      },
    });

    return updatedEvent;
  });
}

export async function recordEmailDispatcherHeartbeat(input: z.input<typeof heartbeatInputSchema>) {
  const parsed = heartbeatInputSchema.parse(input);
  const now = parsed.now ?? new Date();

  return prisma.emailDispatcherHeartbeat.upsert({
    where: { workerId: parsed.workerId },
    update: {
      lastHeartbeatAt: now,
      activeLeaseCount: parsed.activeLeaseCount,
      metadataJson: parsed.metadataJson
        ? (parsed.metadataJson as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
    create: {
      workerId: parsed.workerId,
      lastHeartbeatAt: now,
      activeLeaseCount: parsed.activeLeaseCount,
      metadataJson: parsed.metadataJson
        ? (parsed.metadataJson as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });
}
