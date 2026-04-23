import { describe, expect, it } from "vitest";

import { assertCatalogCutoverCanProceed, resolveCatalogCutoverFlags } from "../../src/lib/catalog/cutover-guards";

describe("catalog cutover controls flags and assertions", () => {
  it("parses cutover flags with safe defaults", () => {
    const flags = resolveCatalogCutoverFlags({});

    expect(flags.dbOnlyCheckoutEnabled).toBe(false);
    expect(flags.rollbackArmed).toBe(false);
    expect(flags.preCutoverValidatorEnforced).toBe(true);
    expect(flags.backfillWritesEnabled).toBe(true);
  });

  it("disables backfill writes when rollback is armed", () => {
    const flags = resolveCatalogCutoverFlags({
      CATALOG_DB_ONLY_CHECKOUT_ENABLED: "1",
      CATALOG_CUTOVER_ROLLBACK_MODE: "1",
      CATALOG_BACKFILL_WRITES_ENABLED: "1",
      CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED: "1",
    });

    expect(flags.rollbackArmed).toBe(true);
    expect(flags.backfillWritesEnabled).toBe(false);
  });

  it("blocks cutover when rollback is armed", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        flags: {
          dbOnlyCheckoutEnabled: true,
          rollbackArmed: true,
          preCutoverValidatorEnforced: true,
          backfillWritesEnabled: false,
        },
        validator: {
          checkedAt: new Date().toISOString(),
          isGreen: true,
          metrics: {
            activePriceCount: 0,
            missingStripePriceIdCount: 0,
            unsyncedActivePriceCount: 0,
            invalidStripePriceIdCount: 0,
            checkoutReadinessFailureCount: 0,
            nonArchivedDuplicateStripePriceIdCount: 0,
          },
          blockers: [],
        },
      }),
    ).toThrow("CATALOG_CUTOVER_ROLLBACK_ARMED");
  });

  it("blocks cutover when validator fails and enforcement is enabled", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        flags: {
          dbOnlyCheckoutEnabled: true,
          rollbackArmed: false,
          preCutoverValidatorEnforced: true,
          backfillWritesEnabled: true,
        },
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

  it("blocks cutover when DB-only checkout flag is disabled", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        flags: {
          dbOnlyCheckoutEnabled: false,
          rollbackArmed: false,
          preCutoverValidatorEnforced: true,
          backfillWritesEnabled: true,
        },
        validator: {
          isGreen: true,
        },
      }),
    ).toThrow("CATALOG_CUTOVER_FLAG_DISABLED");
  });

  it("allows cutover when validator fails but enforcement is disabled", () => {
    expect(() =>
      assertCatalogCutoverCanProceed({
        flags: {
          dbOnlyCheckoutEnabled: true,
          rollbackArmed: false,
          preCutoverValidatorEnforced: false,
          backfillWritesEnabled: true,
        },
        validator: {
          isGreen: false,
        },
      }),
    ).not.toThrow();
  });
});
