import { describe, expect, it } from "vitest";

import { getSafeCallbackPath } from "../../src/lib/auth/safe-callback-url";

describe("getSafeCallbackPath", () => {
  it("returns fallback for non-string values", () => {
    expect(getSafeCallbackPath(undefined)).toBe("/dashboard");
    expect(getSafeCallbackPath(null)).toBe("/dashboard");
    expect(getSafeCallbackPath(42)).toBe("/dashboard");
  });

  it("returns fallback for external and protocol-relative values", () => {
    expect(getSafeCallbackPath("https://evil.example/path")).toBe("/dashboard");
    expect(getSafeCallbackPath("//evil.example/path")).toBe("/dashboard");
  });

  it("returns trimmed internal path", () => {
    expect(getSafeCallbackPath("   /dashboard/profile   ")).toBe("/dashboard/profile");
  });

  it("honors custom fallback", () => {
    expect(getSafeCallbackPath("https://evil.example", "/teacher")).toBe("/teacher");
  });
});
