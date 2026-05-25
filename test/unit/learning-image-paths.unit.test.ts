import { describe, expect, it } from "vitest";

import {
  assertLearningImagePath,
  isLearningImagePath,
} from "../../src/lib/learning/image-paths";

describe("learning image path validation", () => {
  it("accepts canonical learning upload paths", () => {
    expect(isLearningImagePath("/uploads/learning/program-cover.webp")).toBe(true);
    expect(assertLearningImagePath("/uploads/learning/program-cover.webp", "picture1")).toBe(
      "/uploads/learning/program-cover.webp",
    );
  });

  it("rejects legacy learning image paths", () => {
    const legacyLearningPath = ["/images", "learning", "program-cover.jpg"].join("/");
    expect(isLearningImagePath(legacyLearningPath)).toBe(false);
    expect(() => assertLearningImagePath(legacyLearningPath, "picture2")).toThrow(
      "/uploads/learning/",
    );
  });

  it("rejects invalid learning image paths", () => {
    const invalidClassesPath = ["/images", "classes", "not-learning.jpg"].join("/");
    expect(isLearningImagePath(invalidClassesPath)).toBe(false);
    expect(() => assertLearningImagePath(invalidClassesPath, "picture3")).toThrow(
      "/uploads/learning/",
    );
  });
});
