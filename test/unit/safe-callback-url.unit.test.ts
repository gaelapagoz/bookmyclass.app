import { describe, expect, it } from "vitest";

import { getSafeCallbackPath, getPostSignInRedirectUrl } from "../../src/lib/auth/safe-callback-url";

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

  it("returns fallback for localhost callback leakage", () => {
    expect(getSafeCallbackPath("http://localhost:3000/dashboard")).toBe("/dashboard");
    expect(getSafeCallbackPath("/sign-in?callbackUrl=http%3A%2F%2F127.0.0.1%3A3000%2Fdashboard")).toBe("/dashboard");
    expect(getSafeCallbackPath("/sign-in?callbackUrl=http%3A%2F%2F%5B%3A%3A1%5D%3A3000%2Fdashboard")).toBe("/dashboard");
    expect(getSafeCallbackPath("/sign-in?callbackUrl=http%3A%2F%2Flocalhost%3A3000%2Fdashboard")).toBe("/dashboard");
    expect(getSafeCallbackPath("/sign-in?callbackUrl=%252F%252Flocalhost%253A3000%252Fdashboard")).toBe("/dashboard");
  });

  it("passes through valid internal path unchanged", () => {
    expect(getSafeCallbackPath("/book-a-class/yoga-class")).toBe("/book-a-class/yoga-class");
  });

  it("returns trimmed internal path", () => {
    expect(getSafeCallbackPath("   /dashboard/profile   ")).toBe("/dashboard/profile");
  });

  it("honors custom fallback", () => {
    expect(getSafeCallbackPath("https://evil.example", "/teacher")).toBe("/teacher");
  });
});

describe("getPostSignInRedirectUrl", () => {
  it("maps MASTER_ADMIN to /admin", () => {
    expect(getPostSignInRedirectUrl("MASTER_ADMIN")).toBe("/admin");
  });

  it("maps ADMIN to /admin", () => {
    expect(getPostSignInRedirectUrl("ADMIN")).toBe("/admin");
  });

  it("maps TEACHER to /teacher", () => {
    expect(getPostSignInRedirectUrl("TEACHER")).toBe("/teacher");
  });

  it("maps CLIENT to /dashboard", () => {
    expect(getPostSignInRedirectUrl("CLIENT")).toBe("/dashboard");
  });

  it("returns /dashboard when role is undefined", () => {
    expect(getPostSignInRedirectUrl(undefined)).toBe("/dashboard");
  });
});
