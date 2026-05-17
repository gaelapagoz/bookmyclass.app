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

  it("accepts legacy learning image paths during migration", () => {
    expect(isLearningImagePath("/images/learning/program-cover.jpg")).toBe(true);
    expect(assertLearningImagePath("/images/learning/program-cover.jpg", "picture2")).toBe(
      "/images/learning/program-cover.jpg",
    );
  });

  it("rejects invalid learning image paths", () => {
    expect(isLearningImagePath("/images/classes/not-learning.jpg")).toBe(false);
    expect(() => assertLearningImagePath("/images/classes/not-learning.jpg", "picture3")).toThrow(
      "/uploads/learning/",
    );
  });
});
