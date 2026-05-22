import { describe, expect, it } from "vitest";

import { assertCatalogCutoverCanProceed, resolveCatalogCutoverGuards } from "../../src/lib/catalog/cutover-guards";

describe("catalog cutover controls flags and assertions", () => {
  it("returns hardcoded guards with legacy flags removed", () => {
    const guards = resolveCatalogCutoverGuards();

    expect(guards.validatorEnforced).toBe(true);
    expect(guards.backfillWritesEnabled).toBe(true);
    expect(guards.legacyFlagsRemoved).toBe(true);
  });

  it("ignores all removed legacy env flags when resolving guards", () => {
    const snapshot = {
      CATALOG_DB_ONLY_CHECKOUT_ENABLED: process.env.CATALOG_DB_ONLY_CHECKOUT_ENABLED,
      CATALOG_CUTOVER_ROLLBACK_MODE: process.env.CATALOG_CUTOVER_ROLLBACK_MODE,
      CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED: process.env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED,
      CATALOG_BACKFILL_WRITES_ENABLED: process.env.CATALOG_BACKFILL_WRITES_ENABLED,
    };

    try {
      process.env.CATALOG_DB_ONLY_CHECKOUT_ENABLED = "0";
      process.env.CATALOG_CUTOVER_ROLLBACK_MODE = "1";
      process.env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED = "0";
      process.env.CATALOG_BACKFILL_WRITES_ENABLED = "0";

      expect(resolveCatalogCutoverGuards()).toEqual({
        validatorEnforced: true,
        backfillWritesEnabled: true,
        legacyFlagsRemoved: true,
      });
    } finally {
      if (snapshot.CATALOG_DB_ONLY_CHECKOUT_ENABLED === undefined) {
        delete process.env.CATALOG_DB_ONLY_CHECKOUT_ENABLED;
      } else {
        process.env.CATALOG_DB_ONLY_CHECKOUT_ENABLED = snapshot.CATALOG_DB_ONLY_CHECKOUT_ENABLED;
      }

      if (snapshot.CATALOG_CUTOVER_ROLLBACK_MODE === undefined) {
        delete process.env.CATALOG_CUTOVER_ROLLBACK_MODE;
      } else {
        process.env.CATALOG_CUTOVER_ROLLBACK_MODE = snapshot.CATALOG_CUTOVER_ROLLBACK_MODE;
      }

      if (snapshot.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED === undefined) {
        delete process.env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED;
      } else {
        process.env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED = snapshot.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED;
      }

      if (snapshot.CATALOG_BACKFILL_WRITES_ENABLED === undefined) {
        delete process.env.CATALOG_BACKFILL_WRITES_ENABLED;
      } else {
        process.env.CATALOG_BACKFILL_WRITES_ENABLED = snapshot.CATALOG_BACKFILL_WRITES_ENABLED;
      }
    }
  });

  it("blocks cutover when validator fails and enforcement is enabled", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        guards: resolveCatalogCutoverGuards(),
        validator: {
          checkedAt: new Date().toISOString(),
          isGreen: false,
          metrics: {
            activePriceCount: 3,
            missingStripePriceIdCount: 1,
            unsyncedActivePriceCount: 1,
            invalidStripePriceIdCount: 0,
            checkoutReadinessFailureCount: 1,
            nonArchivedDuplicateStripePriceIdCount: 0,
          },
          blockers: ["Active prices missing stripePriceId: 1"],
        },
      }),
    ).toThrow("CATALOG_CUTOVER_VALIDATOR_FAILED");
  });

  it("allows cutover when validator is green", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        guards: resolveCatalogCutoverGuards(),
        validator: {
          isGreen: true,
        },
      }),
    ).not.toThrow();
  });
});
