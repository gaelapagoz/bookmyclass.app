import { describe, expect, it } from "vitest";

import { generateProductSlug } from "@/lib/admin/plan-slug";

describe("generateProductSlug", () => {
  it("generates lowercase hyphenated slug", () => {
    expect(generateProductSlug("Unlimited Monthly Plan")).toBe("unlimited-monthly-plan");
  });

  it("removes special characters and trims", () => {
    expect(generateProductSlug("  Yoga & Pilates ++  ")).toBe("yoga-pilates");
  });

  it("returns empty string for non-sluggable value", () => {
    expect(generateProductSlug("@@@###")).toBe("");
  });
});
