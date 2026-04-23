import { EntitlementScope, EntitlementType, PriceType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CREDIT_LOOKUP_KEYS,
  parseLookupKeyCandidates,
  selectSingleCatalogPrice,
  selectSingleCollectiveRule,
} from "../../scripts/seed-uat-k6-catalog";

describe("seed-uat-k6 catalog selection", () => {
  it("uses deterministic fallback lookup keys when env is empty", () => {
    expect(parseLookupKeyCandidates(undefined, DEFAULT_CREDIT_LOOKUP_KEYS)).toEqual(DEFAULT_CREDIT_LOOKUP_KEYS);
  });

  it("normalizes lookup key list and removes duplicates", () => {
    expect(parseLookupKeyCandidates("  A ,b, a,,B  ", ["x"])).toEqual(["a", "b"]);
  });

  it("selects a single matching price and validates expected type", () => {
    const selected = selectSingleCatalogPrice({
      label: "credit",
      candidateLookupKeys: ["credit-key"],
      prices: [
        { id: "p1", productId: "prod1", lookupKey: "credit-key", priceType: PriceType.ONE_TIME },
        { id: "p2", productId: "prod2", lookupKey: "other-key", priceType: PriceType.RECURRING },
      ],
      expectedPriceType: PriceType.ONE_TIME,
    });

    expect(selected.lookupKey).toBe("credit-key");
  });

  it("fails loudly when price match is missing", () => {
    expect(() =>
      selectSingleCatalogPrice({
        label: "credit",
        candidateLookupKeys: ["credit-key"],
        prices: [],
        expectedPriceType: PriceType.ONE_TIME,
      }),
    ).toThrowError(/Required credit catalog price was not found/);
  });

  it("fails loudly when price match is ambiguous", () => {
    expect(() =>
      selectSingleCatalogPrice({
        label: "credit",
        candidateLookupKeys: ["credit-a", "credit-b"],
        prices: [
          { id: "p1", productId: "prod1", lookupKey: "credit-a", priceType: PriceType.ONE_TIME },
          { id: "p2", productId: "prod2", lookupKey: "credit-b", priceType: PriceType.ONE_TIME },
        ],
        expectedPriceType: PriceType.ONE_TIME,
      }),
    ).toThrowError(/Ambiguous credit catalog price match/);
  });

  it("fails loudly when price type does not match expected type", () => {
    expect(() =>
      selectSingleCatalogPrice({
        label: "recurring",
        candidateLookupKeys: ["recurring-key"],
        prices: [{ id: "p1", productId: "prod1", lookupKey: "recurring-key", priceType: PriceType.ONE_TIME }],
        expectedPriceType: PriceType.RECURRING,
      }),
    ).toThrowError(/Invalid recurring catalog price type/);
  });

  it("selects single collective entitlement rule for required type/scope", () => {
    const rule = selectSingleCollectiveRule({
      label: "recurring",
      productId: "prod1",
      rules: [
        {
          productId: "prod1",
          entitlementType: EntitlementType.UNLIMITED_ACCESS,
          entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
          quantity: null,
          validForDays: null,
          isActive: true,
        },
      ],
      requiredScope: EntitlementScope.COLLECTIVE_CLASSES,
      requiredTypes: [EntitlementType.UNLIMITED_ACCESS],
    });

    expect(rule.entitlementType).toBe(EntitlementType.UNLIMITED_ACCESS);
  });

  it("fails loudly when collective entitlement rule is missing", () => {
    expect(() =>
      selectSingleCollectiveRule({
        label: "credit",
        productId: "prod1",
        rules: [],
        requiredScope: EntitlementScope.COLLECTIVE_CLASSES,
        requiredTypes: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      }),
    ).toThrowError(/Required credit entitlement rule was not found/);
  });

  it("fails loudly when collective entitlement rule is ambiguous", () => {
    expect(() =>
      selectSingleCollectiveRule({
        label: "credit",
        productId: "prod1",
        rules: [
          {
            productId: "prod1",
            entitlementType: EntitlementType.CREDIT_PACK,
            entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
            quantity: 5,
            validForDays: 90,
            isActive: true,
          },
          {
            productId: "prod1",
            entitlementType: EntitlementType.SINGLE_USE,
            entitlementScope: EntitlementScope.COLLECTIVE_CLASSES,
            quantity: 1,
            validForDays: 90,
            isActive: true,
          },
        ],
        requiredScope: EntitlementScope.COLLECTIVE_CLASSES,
        requiredTypes: [EntitlementType.CREDIT_PACK, EntitlementType.SINGLE_USE],
      }),
    ).toThrowError(/Ambiguous credit entitlement rules found/);
  });
});
