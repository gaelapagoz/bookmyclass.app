import { Prisma, PriceType, Role, StripeSyncStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getStripeClient } from "@/lib/payments/stripe";

import { assertCatalogCutoverCanProceed, resolveCatalogCutoverGuards } from "./cutover-guards";
import { isCatalogPriceCheckoutReady } from "./checkout-readiness";

const STRIPE_PRICE_ID_PATTERN = /^price_[A-Za-z0-9_]+$/;

type BackfillResolution =
  | "WOULD_LINK"
  | "LINKED"
  | "ALREADY_LINKED"
  | "SKIPPED_NOT_FOUND"
  | "SKIPPED_INVALID_STRIPE_ID"
  | "SKIPPED_DUPLICATE_CANDIDATE"
  | "SKIPPED_CONFLICT_EXISTING";

type BackfillRow = {
  id: string;
  productId: string;
  lookupKey: string;
  product: {
    name: string;
  };
};

type BackfillCandidateEvaluation = {
  priceId: string;
  productId: string;
  productName: string;
  lookupKey: string;
  resolvedStripePriceId: string | null;
  resolution: BackfillResolution;
  details?: string;
};

export type CatalogBackfillReport = {
  runId: string;
  dryRun: boolean;
  counts: {
    candidates: number;
    linked: number;
    alreadyLinked: number;
    wouldLink: number;
    skippedNotFound: number;
    skippedInvalidStripeId: number;
    skippedDuplicateCandidate: number;
    skippedConflictExisting: number;
  };
  entries: BackfillCandidateEvaluation[];
  policy: {
    duplicateResolvedStripePriceId: "first-created-price-wins";
    invalidStripePriceId: "skip-and-report";
    existingStripePriceConflict: "skip-and-report";
  };
};

type ResolveStripePriceIdByLookupKey = (lookupKey: string) => Promise<string | null>;

export type RunCatalogStripeBackfillInput = {
  actorId: string | null;
  dryRun: boolean;
  runId: string;
  persistEvidence?: boolean;
  resolveStripePriceIdByLookupKey?: ResolveStripePriceIdByLookupKey;
};

export type CatalogPreCutoverValidatorReport = {
  checkedAt: string;
  isGreen: boolean;
  metrics: {
    activePriceCount: number;
    missingStripePriceIdCount: number;
    unsyncedActivePriceCount: number;
    invalidStripePriceIdCount: number;
    checkoutReadinessFailureCount: number;
    nonArchivedDuplicateStripePriceIdCount: number;
  };
  blockers: string[];
};

export type AssertCatalogCutoverCanProceedInput = {
  guards: ReturnType<typeof resolveCatalogCutoverGuards>;
  validator: CatalogPreCutoverValidatorReport;
};

function isValidStripePriceId(value: string): boolean {
  return STRIPE_PRICE_ID_PATTERN.test(value);
}

function isUniqueStripePriceConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002";
  }

  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2002");
}

async function assertCatalogOperationalActor(actorId: string | null): Promise<string> {
  if (!actorId) {
    throw new Error("ADMIN_ACTOR_REQUIRED");
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { id: true, role: true },
  });

  if (!actor || (actor.role !== Role.ADMIN && actor.role !== Role.MASTER_ADMIN)) {
    throw new Error("ADMIN_ACTOR_REQUIRED");
  }

  return actor.id;
}

async function resolveStripePriceIdFromLookupKeyViaStripe(lookupKey: string): Promise<string | null> {
  const stripe = getStripeClient();
  const activeLookup = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });

  if (activeLookup.data[0]?.id) {
    return activeLookup.data[0].id;
  }

  const inactiveLookup = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: false,
    limit: 1,
  });

  return inactiveLookup.data[0]?.id ?? null;
}

export async function runCatalogStripePriceBackfill(input: RunCatalogStripeBackfillInput): Promise<CatalogBackfillReport> {
  const persistEvidence = input.persistEvidence ?? true;
  const actorId = !input.dryRun || persistEvidence ? await assertCatalogOperationalActor(input.actorId) : null;
  const resolveStripePriceIdByLookupKey = input.resolveStripePriceIdByLookupKey ?? resolveStripePriceIdFromLookupKeyViaStripe;
  const now = new Date();

  const candidates = await prisma.price.findMany({
    where: {
      isArchived: false,
      stripePriceId: null,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      productId: true,
      lookupKey: true,
      product: {
        select: {
          name: true,
        },
      },
    },
  });

  const rows: BackfillRow[] = candidates;
  const resolvedByPriceId = new Map<string, string | null>();
  for (const row of rows) {
    resolvedByPriceId.set(row.id, await resolveStripePriceIdByLookupKey(row.lookupKey));
  }

  const firstWinnerByResolvedStripePriceId = new Map<string, string>();
  for (const row of rows) {
    const resolved = resolvedByPriceId.get(row.id);
    if (!resolved || !isValidStripePriceId(resolved)) {
      continue;
    }

    if (!firstWinnerByResolvedStripePriceId.has(resolved)) {
      firstWinnerByResolvedStripePriceId.set(resolved, row.id);
    }
  }

  const resolvedStripeIds = Array.from(firstWinnerByResolvedStripePriceId.keys());
  const existingByStripePriceId = new Map<string, string>();
  if (resolvedStripeIds.length > 0) {
    const existing = await prisma.price.findMany({
      where: {
        stripePriceId: {
          in: resolvedStripeIds,
        },
      },
      select: {
        id: true,
        stripePriceId: true,
      },
    });

    for (const row of existing) {
      if (row.stripePriceId) {
        existingByStripePriceId.set(row.stripePriceId, row.id);
      }
    }
  }

  const entries: BackfillCandidateEvaluation[] = [];
  for (const row of rows) {
    const resolved = resolvedByPriceId.get(row.id) ?? null;
    if (!resolved) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: null,
        resolution: "SKIPPED_NOT_FOUND",
        details: "No Stripe Price found for lookup key.",
      });
      continue;
    }

    if (!isValidStripePriceId(resolved)) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "SKIPPED_INVALID_STRIPE_ID",
        details: "Resolved Stripe ID is not a valid Stripe Price ID.",
      });
      continue;
    }

    const winner = firstWinnerByResolvedStripePriceId.get(resolved);
    if (winner && winner !== row.id) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "SKIPPED_DUPLICATE_CANDIDATE",
        details: `Conflict policy applied: winner is ${winner}.`,
      });
      continue;
    }

    const existingPriceId = existingByStripePriceId.get(resolved);
    if (existingPriceId && existingPriceId !== row.id) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "SKIPPED_CONFLICT_EXISTING",
        details: `Stripe Price ID is already linked by ${existingPriceId}.`,
      });
      continue;
    }

    if (input.dryRun) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "WOULD_LINK",
      });
      continue;
    }

      let updateResult: { count: number };
      try {
        updateResult = await prisma.price.updateMany({
          where: {
            id: row.id,
            stripePriceId: null,
          },
          data: {
            stripePriceId: resolved,
            stripeSyncStatus: StripeSyncStatus.SYNCED,
            stripeSyncLastAttempt: now,
            stripeSyncLastSuccess: now,
            stripeSyncErrorCode: null,
            stripeSyncError: null,
            stripeSyncCorrelation: `catalog-backfill-${input.runId}`,
          },
        });
      } catch (error) {
        if (isUniqueStripePriceConflict(error)) {
          entries.push({
            priceId: row.id,
            productId: row.productId,
            productName: row.product.name,
            lookupKey: row.lookupKey,
            resolvedStripePriceId: resolved,
            resolution: "SKIPPED_CONFLICT_EXISTING",
            details: "Unique conflict while linking Stripe Price ID.",
          });
          continue;
        }

        throw error;
      }

      if (updateResult.count > 0) {
        await prisma.auditLog.create({
          data: {
            actorId,
            actionType: "CATALOG_PRICE_BACKFILL_LINK",
            entityType: "Price",
            entityId: row.id,
          metadata: {
            runId: input.runId,
            lookupKey: row.lookupKey,
            resolvedStripePriceId: resolved,
            ownershipScopeKey: "GLOBAL_CATALOG",
          },
        },
      });

      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "LINKED",
      });
      continue;
    }

    const latest = await prisma.price.findUnique({
      where: { id: row.id },
      select: { stripePriceId: true },
    });

    if (latest?.stripePriceId === resolved) {
      entries.push({
        priceId: row.id,
        productId: row.productId,
        productName: row.product.name,
        lookupKey: row.lookupKey,
        resolvedStripePriceId: resolved,
        resolution: "ALREADY_LINKED",
      });
      continue;
    }

    entries.push({
      priceId: row.id,
      productId: row.productId,
      productName: row.product.name,
      lookupKey: row.lookupKey,
      resolvedStripePriceId: resolved,
      resolution: "SKIPPED_CONFLICT_EXISTING",
      details: "Concurrent update linked a different Stripe Price ID.",
    });
  }

  const counts = {
    candidates: entries.length,
    linked: entries.filter((entry) => entry.resolution === "LINKED").length,
    alreadyLinked: entries.filter((entry) => entry.resolution === "ALREADY_LINKED").length,
    wouldLink: entries.filter((entry) => entry.resolution === "WOULD_LINK").length,
    skippedNotFound: entries.filter((entry) => entry.resolution === "SKIPPED_NOT_FOUND").length,
    skippedInvalidStripeId: entries.filter((entry) => entry.resolution === "SKIPPED_INVALID_STRIPE_ID").length,
    skippedDuplicateCandidate: entries.filter((entry) => entry.resolution === "SKIPPED_DUPLICATE_CANDIDATE").length,
    skippedConflictExisting: entries.filter((entry) => entry.resolution === "SKIPPED_CONFLICT_EXISTING").length,
  };

  const report: CatalogBackfillReport = {
    runId: input.runId,
    dryRun: input.dryRun,
    counts,
    entries,
    policy: {
      duplicateResolvedStripePriceId: "first-created-price-wins",
      invalidStripePriceId: "skip-and-report",
      existingStripePriceConflict: "skip-and-report",
    },
  };

  if (persistEvidence) {
    await prisma.auditLog.create({
      data: {
        actorId,
        actionType: input.dryRun ? "CATALOG_PRICE_BACKFILL_DRY_RUN" : "CATALOG_PRICE_BACKFILL_RUN",
        entityType: "CatalogCutover",
        entityId: null,
        metadata: {
          runId: report.runId,
          dryRun: report.dryRun,
          counts: report.counts,
          policy: report.policy,
          ownershipScopeKey: "GLOBAL_CATALOG",
        },
      },
    });
  }

  return report;
}

function countDuplicateStripePriceIds(rows: Array<{ stripePriceId: string | null }>): number {
  const countsByStripePriceId = new Map<string, number>();
  for (const row of rows) {
    if (!row.stripePriceId) {
      continue;
    }
    countsByStripePriceId.set(row.stripePriceId, (countsByStripePriceId.get(row.stripePriceId) ?? 0) + 1);
  }

  return Array.from(countsByStripePriceId.values()).filter((count) => count > 1).length;
}

export async function runCatalogPreCutoverValidator(input?: {
  actorId?: string | null;
  runId?: string;
  persistEvidence?: boolean;
}): Promise<CatalogPreCutoverValidatorReport> {
  const persistEvidence = input?.persistEvidence ?? false;
  const activePrices = await prisma.price.findMany({
    where: {
      isActive: true,
      isArchived: false,
    },
    select: {
      id: true,
      priceType: true,
      currencyCode: true,
      unitAmountMinor: true,
      billingInterval: true,
      billingIntervalCount: true,
      stripePriceId: true,
      stripeSyncStatus: true,
    },
  });

  const nonArchivedPriceIds = await prisma.price.findMany({
    where: {
      isArchived: false,
      stripePriceId: {
        not: null,
      },
    },
    select: {
      stripePriceId: true,
    },
  });

  const missingStripePriceIdCount = activePrices.filter((price) => !price.stripePriceId).length;
  const unsyncedActivePriceCount = activePrices.filter(
    (price) => Boolean(price.stripePriceId) && price.stripeSyncStatus !== StripeSyncStatus.SYNCED,
  ).length;
  const invalidStripePriceIdCount = nonArchivedPriceIds.filter(
    (row) => Boolean(row.stripePriceId) && !isValidStripePriceId(row.stripePriceId as string),
  ).length;
  const checkoutReadinessFailureCount = activePrices.filter(
    (price) =>
      !isCatalogPriceCheckoutReady({
        priceType: price.priceType as PriceType,
        currencyCode: price.currencyCode,
        unitAmountMinor: price.unitAmountMinor,
        billingInterval: price.billingInterval,
        billingIntervalCount: price.billingIntervalCount,
        stripePriceId: price.stripePriceId,
        stripeSyncStatus: price.stripeSyncStatus,
      }),
  ).length;
  const duplicateStripePriceIdCount = countDuplicateStripePriceIds(nonArchivedPriceIds);

  const blockers: string[] = [];
  if (missingStripePriceIdCount > 0) {
    blockers.push(`Active prices missing stripePriceId: ${missingStripePriceIdCount}`);
  }
  if (unsyncedActivePriceCount > 0) {
    blockers.push(`Active prices not in SYNCED status: ${unsyncedActivePriceCount}`);
  }
  if (invalidStripePriceIdCount > 0) {
    blockers.push(`Invalid Stripe Price ID format count: ${invalidStripePriceIdCount}`);
  }
  if (checkoutReadinessFailureCount > 0) {
    blockers.push(`Checkout readiness invariant failures: ${checkoutReadinessFailureCount}`);
  }
  if (duplicateStripePriceIdCount > 0) {
    blockers.push(`Duplicate non-archived stripePriceId count: ${duplicateStripePriceIdCount}`);
  }

  const report = {
    checkedAt: new Date().toISOString(),
    isGreen: blockers.length === 0,
    metrics: {
      activePriceCount: activePrices.length,
      missingStripePriceIdCount,
      unsyncedActivePriceCount,
      invalidStripePriceIdCount,
      checkoutReadinessFailureCount,
      nonArchivedDuplicateStripePriceIdCount: duplicateStripePriceIdCount,
    },
    blockers,
  };

  if (persistEvidence) {
    const actorId = await assertCatalogOperationalActor(input?.actorId ?? null);
    const runId = input?.runId ?? `validator-${Date.now()}`;

    await prisma.auditLog.create({
      data: {
        actorId,
        actionType: "CATALOG_PRE_CUTOVER_VALIDATION",
        entityType: "CatalogCutover",
        entityId: null,
        metadata: {
          runId,
          checkedAt: report.checkedAt,
          isGreen: report.isGreen,
          metrics: report.metrics,
          blockers: report.blockers,
          ownershipScopeKey: "GLOBAL_CATALOG",
        },
      },
    });
  }

  return report;
}

export { resolveCatalogCutoverGuards, assertCatalogCutoverCanProceed };

export async function captureCatalogCutoverRollbackRehearsal(input: {
  actorId: string | null;
  environment: "UAT" | "LOCAL";
  notes?: string;
}) {
  const actorId = await assertCatalogOperationalActor(input.actorId);

  const recordedAt = new Date().toISOString();
  await prisma.auditLog.create({
    data: {
      actorId,
      actionType: "CATALOG_CUTOVER_ROLLBACK_REHEARSAL",
      entityType: "CatalogCutover",
      entityId: null,
      metadata: {
        environment: input.environment,
        legacyFlagsRemoved: true,
        notes: input.notes?.trim() || null,
        recordedAt,
        controlInstructions: {
          rollbackMode: "legacy cutover rollback flags removed",
        },
      },
    },
  });

  return {
    recordedAt,
    environment: input.environment,
    legacyFlagsRemoved: true,
  };
}
