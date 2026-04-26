import { EntitlementScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { resolveEntitlementScope, resolveEntitlementScopeFromCategorySlug } from "@/lib/booking/entitlement-scope";

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

describe("resolveEntitlementScope", () => {
  it("returns serviceScope directly when set, ignoring categorySlug", () => {
    expect(
      resolveEntitlementScope({
        serviceScope: EntitlementScope.PRIVATE_CLASSES,
        categorySlug: "collective-classes",
      }),
    ).toBe(EntitlementScope.PRIVATE_CLASSES);

    expect(
      resolveEntitlementScope({
        serviceScope: EntitlementScope.WORKSHOPS,
        categorySlug: "yoga",
      }),
    ).toBe(EntitlementScope.WORKSHOPS);
  });

  it("falls back to slug resolution when serviceScope is null", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveEntitlementScope({ serviceScope: null, categorySlug: "private-sessions" }),
    ).toBe(EntitlementScope.PRIVATE_CLASSES);

    expect(
      resolveEntitlementScope({ serviceScope: null, categorySlug: "yoga" }),
    ).toBe(EntitlementScope.COLLECTIVE_CLASSES);
    warn.mockRestore();
  });

  it("falls back to slug resolution when serviceScope is undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveEntitlementScope({ serviceScope: undefined, categorySlug: "workshops" }),
    ).toBe(EntitlementScope.WORKSHOPS);
    warn.mockRestore();
  });

  it("emits console.warn with slug name when falling back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveEntitlementScope({ serviceScope: null, categorySlug: "yoga" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("serviceScope is null");
    expect(warn.mock.calls[0][0]).toContain("yoga");
    warn.mockRestore();
  });

  it("does not emit console.warn when serviceScope is set", () => {
    const warn = vi.spyOn(console, "warn");
    resolveEntitlementScope({ serviceScope: EntitlementScope.COLLECTIVE_CLASSES, categorySlug: "yoga" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
