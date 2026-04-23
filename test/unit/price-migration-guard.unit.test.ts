import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("price migration guard", () => {
  it("includes a fail-fast guard before unique active price index creation", () => {
    const migrationPath = resolve(
      process.cwd(),
      "prisma/migrations/20260421120000_price_sync_invariants/migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("Price migration blocked:");
    expect(sql).toContain("Price_productId_single_active_unarchived_idx");
    expect(sql).toContain("HAVING COUNT(*) > 1");
    expect(sql).toContain("invalid currencyCode format before Price_currencyCode_uppercase_3_chk");
    expect(sql).toContain("invalid priceType/billingInterval/billingIntervalCount shape before Price_billing_shape_chk");
  });

  it("includes immutable field trigger for activated/purchased prices", () => {
    const migrationPath = resolve(
      process.cwd(),
      "prisma/migrations/20260422103000_price_immutability_guards/migration.sql",
    );
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toContain("enforce_price_immutable_fields");
    expect(sql).toContain("Price_enforce_immutable_fields_trg");
    expect(sql).toContain("stripePriceId is immutable after activation/purchase");
    expect(sql).toContain("OLD.\"stripePriceId\" IS NOT NULL OR NEW.\"stripePriceId\" IS NOT NULL");
    expect(sql).toContain("is_initial_activation");
    expect(sql).toContain("PriceStripeIdRemediationRequest");
    expect(sql).toContain("remediate_price_stripe_id");
    expect(sql).toContain("CATALOG_PRICE_STRIPE_REMEDIATION");
  });
});
