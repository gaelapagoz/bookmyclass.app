import { EntitlementScope } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { resolveEntitlementScopeFromCategorySlug } from "@/lib/booking/entitlement-scope";

describe("resolveEntitlementScopeFromCategorySlug", () => {
  it("returns PRIVATE_CLASSES for slugs containing 'private'", () => {
    expect(resolveEntitlementScopeFromCategorySlug("private-sessions")).toBe(
      EntitlementScope.PRIVATE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("private-classes")).toBe(
      EntitlementScope.PRIVATE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("semi-private")).toBe(
      EntitlementScope.PRIVATE_CLASSES,
    );
  });

  it("returns WORKSHOPS for slugs containing 'workshop'", () => {
    expect(resolveEntitlementScopeFromCategorySlug("workshops")).toBe(
      EntitlementScope.WORKSHOPS,
    );
    expect(resolveEntitlementScopeFromCategorySlug("weekend-workshop")).toBe(
      EntitlementScope.WORKSHOPS,
    );
    expect(resolveEntitlementScopeFromCategorySlug("corporate-workshops")).toBe(
      EntitlementScope.WORKSHOPS,
    );
  });

  it("returns COLLECTIVE_CLASSES for collective/general slugs", () => {
    expect(resolveEntitlementScopeFromCategorySlug("collective-classes")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("yoga")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("pilates")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
  });

  it("is case-insensitive", () => {
    expect(resolveEntitlementScopeFromCategorySlug("PRIVATE-SESSIONS")).toBe(
      EntitlementScope.PRIVATE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("WORKSHOP")).toBe(
      EntitlementScope.WORKSHOPS,
    );
    expect(resolveEntitlementScopeFromCategorySlug("Collective")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
  });

  it("private takes precedence over workshop when both keywords are present", () => {
    expect(resolveEntitlementScopeFromCategorySlug("private-workshop")).toBe(
      EntitlementScope.PRIVATE_CLASSES,
    );
  });

  it("handles slugs with unusual shapes gracefully", () => {
    expect(resolveEntitlementScopeFromCategorySlug("  ")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
    expect(resolveEntitlementScopeFromCategorySlug("123-category")).toBe(
      EntitlementScope.COLLECTIVE_CLASSES,
    );
  });
});
