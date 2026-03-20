import { describe, expect, it } from "vitest";

function sum(a: number, b: number) {
  return a + b;
}

describe("unit example", () => {
  it("sums numbers", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
