import { describe, expect, it } from "vitest";

import {
  evaluateMediaHardCutoverReadiness,
  isLegacyMediaPath,
} from "@/lib/readiness/hard-cutover-readiness";

describe("hard cutover readiness", () => {
  it("flags legacy media paths", () => {
    const legacyClassesImagePath = ["/images", "classes", "example.png"].join("/");
    const legacyClassesRoot = ["/images", "classes"].join("/");
    expect(isLegacyMediaPath(legacyClassesImagePath)).toBe(true);
    expect(isLegacyMediaPath(legacyClassesRoot)).toBe(true);
    expect(isLegacyMediaPath("public/images")).toBe(true);
    expect(isLegacyMediaPath("/uploads/classes/example.png")).toBe(false);
  });

  it("fails media readiness when legacy references are present", () => {
    const result = evaluateMediaHardCutoverReadiness([
      { label: "User.image", count: 1 },
      { label: "ClassType.imageUrl", count: 0 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.blockers).toContain("User.image has 1 legacy media path reference(s)");
  });

});
