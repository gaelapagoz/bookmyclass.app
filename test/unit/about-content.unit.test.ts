import { describe, expect, it } from "vitest";

import { studioPageContent } from "@/lib/public-content/about-content";

describe("studioPageContent image paths", () => {
  it("uses canonical uploads/classes paths only", () => {
    const imagePaths = studioPageContent.images.map((image) => image.src);

    expect(imagePaths).toEqual([
      "/uploads/classes/vinyasa-yoga.jpg",
      "/uploads/classes/mat-pilates.jpg",
      "/uploads/classes/functional-strength.jpg",
    ]);
    expect(imagePaths.every((path) => path.startsWith("/uploads/classes/"))).toBe(true);
    expect(imagePaths.some((path) => path.startsWith("/images/classes/"))).toBe(false);
  });
});
