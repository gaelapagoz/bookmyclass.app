import "./helpers/setup-env";

import { BillingInterval, PriceType, ProductType, Role, StripeSyncStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureCatalogCutoverRollbackRehearsal,
  runCatalogPreCutoverValidator,
  runCatalogStripePriceBackfill,
} from "../../src/lib/catalog/cutover-controls";
import { prisma as appPrisma } from "../../src/lib/db";
import { prisma } from "./helpers/db";
import { resetDb } from "./helpers/reset-db";

describe("catalog cutover controls", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createProductWithPrice(input: {
    name: string;
    lookupKey: string;
    stripePriceId: string | null;
    stripeSyncStatus?: StripeSyncStatus;
    isActive?: boolean;
    priceType?: PriceType;
    billingInterval?: BillingInterval | null;
    billingIntervalCount?: number | null;
  }) {
    const product = await prisma.product.create({
      data: {
        name: input.name,
        slug: `${input.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        productType: ProductType.UNLIMITED_MEMBERSHIP,
        isActive: true,
        isArchived: false,
        sortOrder: 1,
      },
      select: { id: true },
    });

    const price = await prisma.price.create({
      data: {
        productId: product.id,
        lookupKey: input.lookupKey,
        name: `${input.name} Price`,
        priceType: input.priceType ?? PriceType.RECURRING,
        currencyCode: "EUR",
        unitAmountMinor: 7900,
        billingInterval: input.billingInterval === undefined ? BillingInterval.MONTH : input.billingInterval,
        billingIntervalCount: input.billingIntervalCount === undefined ? 1 : input.billingIntervalCount,
        stripePriceId: input.stripePriceId,
        stripeSyncStatus: input.stripeSyncStatus ?? (input.stripePriceId ? StripeSyncStatus.SYNCED : StripeSyncStatus.PENDING),
        isActive: input.isActive ?? true,
        isArchived: false,
      },
      select: { id: true, productId: true, lookupKey: true, stripePriceId: true },
    });

    return price;
  }

  async function createAdminActor() {
    return prisma.user.create({
      data: {
        name: "Admin Actor",
        email: `admin.actor.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
      select: { id: true },
    });
  }

  it("runs dry-run backfill and reports explicit conflict policy outcomes without mutating data", async () => {
    const existing = await createProductWithPrice({
      name: "Existing Linked",
      lookupKey: `lk-existing-${Date.now()}`,
      stripePriceId: "price_existing_conflict_1",
    });

    const valid = await createProductWithPrice({
      name: "Valid Candidate",
      lookupKey: `lk-valid-${Date.now()}`,
      stripePriceId: null,
    });
    const duplicateWinner = await createProductWithPrice({
      name: "Duplicate Winner",
      lookupKey: `lk-dup-a-${Date.now()}`,
      stripePriceId: null,
    });
    const duplicateLoser = await createProductWithPrice({
      name: "Duplicate Loser",
      lookupKey: `lk-dup-b-${Date.now()}`,
      stripePriceId: null,
    });
    const invalid = await createProductWithPrice({
      name: "Invalid Candidate",
      lookupKey: `lk-invalid-${Date.now()}`,
      stripePriceId: null,
    });
    const missing = await createProductWithPrice({
      name: "Missing Candidate",
      lookupKey: `lk-missing-${Date.now()}`,
      stripePriceId: null,
    });
    const conflict = await createProductWithPrice({
      name: "Conflict Candidate",
      lookupKey: `lk-conflict-${Date.now()}`,
      stripePriceId: null,
    });

    const report = await runCatalogStripePriceBackfill({
      actorId: null,
      dryRun: true,
      runId: `phase5-dry-run-${Date.now()}`,
      persistEvidence: false,
      resolveStripePriceIdByLookupKey: async (lookupKey) => {
        const map: Record<string, string | null> = {
          [valid.lookupKey]: "price_backfill_valid_1",
          [duplicateWinner.lookupKey]: "price_backfill_dup_1",
          [duplicateLoser.lookupKey]: "price_backfill_dup_1",
          [invalid.lookupKey]: "not_a_price_id",
          [missing.lookupKey]: null,
          [conflict.lookupKey]: existing.stripePriceId!,
        };
        return map[lookupKey] ?? null;
      },
    });

    expect(report.dryRun).toBe(true);
    expect(report.counts.candidates).toBe(6);
    expect(report.counts.wouldLink).toBe(2);
    expect(report.counts.skippedDuplicateCandidate).toBe(1);
    expect(report.counts.skippedInvalidStripeId).toBe(1);
    expect(report.counts.skippedNotFound).toBe(1);
    expect(report.counts.skippedConflictExisting).toBe(1);

    const refreshed = await prisma.price.findMany({
      where: { id: { in: [valid.id, duplicateWinner.id, duplicateLoser.id, invalid.id, missing.id, conflict.id] } },
      select: { id: true, stripePriceId: true },
    });

    expect(refreshed.every((row) => row.stripePriceId === null)).toBe(true);
  });

  it("backfills idempotently and reports conflicts on rerun", async () => {
    const actor = await createAdminActor();
    const first = await createProductWithPrice({
      name: "First Candidate",
      lookupKey: `lk-first-${Date.now()}`,
      stripePriceId: null,
    });
    const second = await createProductWithPrice({
      name: "Second Candidate",
      lookupKey: `lk-second-${Date.now()}`,
      stripePriceId: null,
    });

    const run1 = await runCatalogStripePriceBackfill({
      actorId: actor.id,
      dryRun: false,
      runId: `phase5-run1-${Date.now()}`,
      persistEvidence: false,
      resolveStripePriceIdByLookupKey: async (lookupKey) =>
        lookupKey === first.lookupKey ? "price_shared_phase5_1" : "price_shared_phase5_1",
    });

    expect(run1.counts.linked).toBe(1);
    expect(run1.counts.skippedDuplicateCandidate).toBe(1);

    const run2 = await runCatalogStripePriceBackfill({
      actorId: actor.id,
      dryRun: false,
      runId: `phase5-run2-${Date.now()}`,
      persistEvidence: false,
      resolveStripePriceIdByLookupKey: async (lookupKey) =>
        lookupKey === first.lookupKey ? "price_shared_phase5_1" : "price_shared_phase5_1",
    });

    expect(run2.counts.linked).toBe(0);
    expect(run2.counts.skippedConflictExisting).toBe(1);

    const linked = await prisma.price.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { id: true, stripePriceId: true },
    });

    const nonNull = linked.filter((row) => row.stripePriceId !== null);
    expect(nonNull).toHaveLength(1);
    expect(nonNull[0]?.stripePriceId).toBe("price_shared_phase5_1");
  });

  it("returns blocker-rich validator report until catalog is cutover-ready", async () => {
    const ready = await createProductWithPrice({
      name: "Ready Product",
      lookupKey: `lk-ready-${Date.now()}`,
      stripePriceId: "price_ready_cutover_1",
      stripeSyncStatus: StripeSyncStatus.SYNCED,
    });

    const notReady = await createProductWithPrice({
      name: "Not Ready Product",
      lookupKey: `lk-not-ready-${Date.now()}`,
      stripePriceId: null,
      stripeSyncStatus: StripeSyncStatus.PENDING,
    });

    const firstReport = await runCatalogPreCutoverValidator();
    expect(firstReport.isGreen).toBe(false);
    expect(firstReport.metrics.missingStripePriceIdCount).toBe(1);
    expect(firstReport.metrics.checkoutReadinessFailureCount).toBeGreaterThanOrEqual(1);

    await prisma.price.update({
      where: { id: notReady.id },
      data: {
        stripePriceId: "price_ready_cutover_2",
        stripeSyncStatus: StripeSyncStatus.SYNCED,
      },
    });

    const secondReport = await runCatalogPreCutoverValidator();
    expect(secondReport.isGreen).toBe(true);
    expect(secondReport.blockers).toEqual([]);
    expect(secondReport.metrics.activePriceCount).toBeGreaterThanOrEqual(2);

    const refreshedReady = await prisma.price.findUnique({
      where: { id: ready.id },
      select: { stripePriceId: true },
    });
    expect(refreshedReady?.stripePriceId).toBe("price_ready_cutover_1");
  });

  it("captures rollback rehearsal evidence in audit log for Gate 2 proof", async () => {
    const actor = await prisma.user.create({
      data: {
        name: "Operator",
        email: `operator.${Date.now()}@example.test`,
        role: Role.ADMIN,
      },
      select: { id: true },
    });

    const evidence = await captureCatalogCutoverRollbackRehearsal({
      actorId: actor.id,
      environment: "UAT",
      notes: "Rollback rehearsal before Gate 2 signoff.",
      beforeDbOnlyCheckoutEnabled: true,
    });

    expect(evidence.environment).toBe("UAT");
    expect(evidence.beforeDbOnlyCheckoutEnabled).toBe(true);
    expect(evidence.afterDbOnlyCheckoutEnabled).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: {
        actionType: "CATALOG_CUTOVER_ROLLBACK_REHEARSAL",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(actor.id);
  });

  it("rejects unauthorized actor for mutating backfill and rollback evidence capture", async () => {
    await createProductWithPrice({
      name: "Unauthorized Candidate",
      lookupKey: `lk-unauthorized-${Date.now()}`,
      stripePriceId: null,
    });

    await expect(
      runCatalogStripePriceBackfill({
        actorId: null,
        dryRun: false,
        runId: `phase5-unauthorized-${Date.now()}`,
        persistEvidence: false,
        resolveStripePriceIdByLookupKey: async () => "price_unauthorized_blocked_1",
      }),
    ).rejects.toThrow("ADMIN_ACTOR_REQUIRED");

    await expect(
      captureCatalogCutoverRollbackRehearsal({
        actorId: null,
        environment: "UAT",
      }),
    ).rejects.toThrow("ADMIN_ACTOR_REQUIRED");
  });

  it("blocks backfill writes when rollback is armed or writes are disabled by flags", async () => {
    const actor = await createAdminActor();
    const rollbackCandidate = await createProductWithPrice({
      name: "Rollback Block Candidate",
      lookupKey: `lk-rollback-block-${Date.now()}`,
      stripePriceId: null,
    });
    const disabledCandidate = await createProductWithPrice({
      name: "Disabled Block Candidate",
      lookupKey: `lk-disabled-block-${Date.now()}`,
      stripePriceId: null,
    });

    const previousRollback = process.env.CATALOG_CUTOVER_ROLLBACK_MODE;
    const previousWrites = process.env.CATALOG_BACKFILL_WRITES_ENABLED;
    try {
      process.env.CATALOG_CUTOVER_ROLLBACK_MODE = "1";
      delete process.env.CATALOG_BACKFILL_WRITES_ENABLED;
      await expect(
        runCatalogStripePriceBackfill({
          actorId: actor.id,
          dryRun: false,
          runId: `phase5-rollback-armed-${Date.now()}`,
          persistEvidence: false,
          resolveStripePriceIdByLookupKey: async () => "price_blocked_rollback_1",
        }),
      ).rejects.toThrow("CATALOG_BACKFILL_ROLLBACK_ARMED");

      process.env.CATALOG_CUTOVER_ROLLBACK_MODE = "0";
      process.env.CATALOG_BACKFILL_WRITES_ENABLED = "0";
      await expect(
        runCatalogStripePriceBackfill({
          actorId: actor.id,
          dryRun: false,
          runId: `phase5-writes-disabled-${Date.now()}`,
          persistEvidence: false,
          resolveStripePriceIdByLookupKey: async () => "price_blocked_disabled_1",
        }),
      ).rejects.toThrow("CATALOG_BACKFILL_WRITES_DISABLED");
    } finally {
      if (previousRollback === undefined) {
        delete process.env.CATALOG_CUTOVER_ROLLBACK_MODE;
      } else {
        process.env.CATALOG_CUTOVER_ROLLBACK_MODE = previousRollback;
      }

      if (previousWrites === undefined) {
        delete process.env.CATALOG_BACKFILL_WRITES_ENABLED;
      } else {
        process.env.CATALOG_BACKFILL_WRITES_ENABLED = previousWrites;
      }
    }

    const persisted = await prisma.price.findMany({
      where: { id: { in: [rollbackCandidate.id, disabledCandidate.id] } },
      select: { stripePriceId: true },
    });
    expect(persisted.every((row) => row.stripePriceId === null)).toBe(true);
  });

  it("records dry-run and validator evidence summaries in audit log", async () => {
    const actor = await createAdminActor();
    const dryRunCandidate = await createProductWithPrice({
      name: "Dry Run Evidence Candidate",
      lookupKey: `lk-dry-run-evidence-${Date.now()}`,
      stripePriceId: null,
    });

    const dryRunId = `phase5-dry-run-evidence-${Date.now()}`;
    const dryRunReport = await runCatalogStripePriceBackfill({
      actorId: actor.id,
      dryRun: true,
      runId: dryRunId,
      resolveStripePriceIdByLookupKey: async (lookupKey) =>
        lookupKey === dryRunCandidate.lookupKey ? "price_dry_run_evidence_1" : null,
    });
    expect(dryRunReport.counts.wouldLink).toBe(1);

    const validatorRunId = `phase5-validator-evidence-${Date.now()}`;
    const validatorReport = await runCatalogPreCutoverValidator({
      actorId: actor.id,
      runId: validatorRunId,
      persistEvidence: true,
    });
    expect(validatorReport.isGreen).toBe(false);

    const auditRows = await prisma.auditLog.findMany({
      where: {
        actionType: {
          in: ["CATALOG_PRICE_BACKFILL_DRY_RUN", "CATALOG_PRE_CUTOVER_VALIDATION"],
        },
      },
      orderBy: { createdAt: "asc" },
    });

    expect(auditRows.some((row) => row.actionType === "CATALOG_PRICE_BACKFILL_DRY_RUN")).toBe(true);
    expect(auditRows.some((row) => row.actionType === "CATALOG_PRE_CUTOVER_VALIDATION")).toBe(true);
  });

  it("reports unique conflict during write as deterministic conflict outcome", async () => {
    const actor = await createAdminActor();
    const candidate = await createProductWithPrice({
      name: "Conflict Candidate",
      lookupKey: `lk-unique-conflict-${Date.now()}`,
      stripePriceId: null,
    });

    const updateSpy = vi.spyOn(appPrisma.price, "updateMany").mockRejectedValueOnce({ code: "P2002" });
    try {
      const report = await runCatalogStripePriceBackfill({
        actorId: actor.id,
        dryRun: false,
        runId: `phase5-unique-conflict-${Date.now()}`,
        persistEvidence: false,
        resolveStripePriceIdByLookupKey: async () => "price_unique_conflict_1",
      });

      expect(report.entries).toContainEqual(
        expect.objectContaining({
          priceId: candidate.id,
          resolution: "SKIPPED_CONFLICT_EXISTING",
        }),
      );
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("persists sync metadata and audit payload runId for linked writes", async () => {
    const actor = await createAdminActor();
    const runId = `phase5-link-metadata-${Date.now()}`;
    const candidate = await createProductWithPrice({
      name: "Metadata Candidate",
      lookupKey: `lk-metadata-${Date.now()}`,
      stripePriceId: null,
    });

    await runCatalogStripePriceBackfill({
      actorId: actor.id,
      dryRun: false,
      runId,
      persistEvidence: false,
      resolveStripePriceIdByLookupKey: async () => "price_metadata_1",
    });

    const linked = await prisma.price.findUnique({
      where: { id: candidate.id },
      select: {
        stripePriceId: true,
        stripeSyncLastSuccess: true,
        stripeSyncCorrelation: true,
      },
    });
    expect(linked?.stripePriceId).toBe("price_metadata_1");
    expect(linked?.stripeSyncLastSuccess).not.toBeNull();
    expect(linked?.stripeSyncCorrelation).toBe(`catalog-backfill-${runId}`);

    const audit = await prisma.auditLog.findFirst({
      where: {
        actionType: "CATALOG_PRICE_BACKFILL_LINK",
        entityId: candidate.id,
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect((audit?.metadata as { runId?: string } | null)?.runId).toBe(runId);
  });
});
