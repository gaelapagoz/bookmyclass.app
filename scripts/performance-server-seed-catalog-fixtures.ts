/**
 * Performance server seed catalog fixtures
 *
 * Purpose:
 * - Operational script for this repository's server/local workflows.
 *
 * Safety:
 * - Mutating operation. Review target variables before running.
 *
 * Variables:
 * - TARGET_ENV (optional), BASE_URL (default https://demo.bookmyclass.app), APP_DIR (default /var/www/bookmyclass), APP_NAME (default bookmyclass-app).
 *
 * Usage:
 *   tsx scripts/performance-server-seed-catalog-fixtures.ts
 */
import { EntitlementScope, EntitlementType, PriceType } from "@prisma/client";

export const DEFAULT_CREDIT_LOOKUP_KEYS = ["qa-collective-5-pack-eur-once-v1"];
export const DEFAULT_RECURRING_LOOKUP_KEYS = ["monthly-unlimited-collective-eur-monthly-v1"];

type CatalogPrice = {
  id: string;
  productId: string;
  lookupKey: string;
  priceType: PriceType;
};

type CatalogRule = {
  productId: string;
  entitlementType: EntitlementType;
  entitlementScope: EntitlementScope;
  quantity: number | null;
  validForDays: number | null;
  isActive: boolean;
};

function normalizeLookupKeyList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

export function parseLookupKeyCandidates(raw: string | undefined, fallback: string[]): string[] {
  const parsed = (raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (!parsed.length) {
    return normalizeLookupKeyList(fallback);
  }
  return normalizeLookupKeyList(parsed);
}

type PriceSelectionParams = {
  label: "credit" | "recurring";
  candidateLookupKeys: string[];
  prices: CatalogPrice[];
  expectedPriceType: PriceType;
};

export function selectSingleCatalogPrice(params: PriceSelectionParams): CatalogPrice {
  const candidateKeySet = new Set(params.candidateLookupKeys.map((key) => key.trim().toLowerCase()));
  const matches = params.prices.filter((price) => candidateKeySet.has(price.lookupKey.trim().toLowerCase()));

  if (matches.length === 0) {
    throw new Error(
      `Required ${params.label} catalog price was not found. Lookups tried: ${params.candidateLookupKeys.join(", ")}`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous ${params.label} catalog price match. Matched lookup keys: ${matches.map((price) => price.lookupKey).join(", ")}`,
    );
  }

  const selected = matches[0]!;
  if (selected.priceType !== params.expectedPriceType) {
    throw new Error(
      `Invalid ${params.label} catalog price type for lookup '${selected.lookupKey}'. Expected ${params.expectedPriceType}, got ${selected.priceType}.`,
    );
  }
  return selected;
}

type RuleSelectionParams = {
  label: "credit" | "recurring";
  productId: string;
  rules: CatalogRule[];
  requiredTypes: EntitlementType[];
  requiredScope: EntitlementScope;
};

export function selectSingleCollectiveRule(params: RuleSelectionParams): CatalogRule {
  const matches = params.rules.filter(
    (rule) =>
      rule.productId === params.productId &&
      rule.isActive &&
      rule.entitlementScope === params.requiredScope &&
      params.requiredTypes.includes(rule.entitlementType),
  );

  if (matches.length === 0) {
    throw new Error(
      `Required ${params.label} entitlement rule was not found for collective scope. productId=${params.productId}`,
    );
  }

  if (matches.length > 1) {
    throw new Error(
      `Ambiguous ${params.label} entitlement rules found for collective scope. productId=${params.productId}`,
    );
  }

  return matches[0]!;
}
