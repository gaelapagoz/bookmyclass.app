import { describe, expect, it } from "vitest";

import { generatePlanSlug } from "@/lib/admin/plan-slug";

describe("generatePlanSlug", () => {
  it("generates lowercase hyphenated slug", () => {
    expect(generatePlanSlug("Unlimited Monthly Plan")).toBe("unlimited-monthly-plan");
  });

  it("removes special characters and trims", () => {
    expect(generatePlanSlug("  Yoga & Pilates ++  ")).toBe("yoga-pilates");
  });

  it("returns empty string for non-sluggable value", () => {
    expect(generatePlanSlug("@@@###")).toBe("");
  });
});
