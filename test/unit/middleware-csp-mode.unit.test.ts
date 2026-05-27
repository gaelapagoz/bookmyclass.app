import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

async function loadMiddleware() {
  vi.resetModules();
  const mod = await import("../../middleware");
  return mod.middleware;
}

function buildRequest(pathname: string) {
  return new NextRequest(new Request(`https://example.com${pathname}`));
}

function buildUatRequest(pathname: string) {
  return new NextRequest(new Request(`https://uat.bookmyclass.app${pathname}`));
}

describe("middleware CSP mode emission", () => {
  it("emits report-only header when configured outside production", async () => {
    process.env.CSP_HEADER_MODE = "report-only";
    process.env.NODE_ENV = "test";
    const middleware = await loadMiddleware();

    const response = middleware(buildRequest("/sign-in"));

    expect(response.headers.has("Content-Security-Policy-Report-Only")).toBe(true);
    expect(response.headers.has("Content-Security-Policy")).toBe(false);
    expect(response.headers.get("Content-Security-Policy-Report-Only")).toContain("script-src");
  });

  it("emits enforce header when mode is invalid", async () => {
    process.env.CSP_HEADER_MODE = "unexpected-value";
    process.env.NODE_ENV = "test";
    const middleware = await loadMiddleware();

    const response = middleware(buildRequest("/sign-in"));

    expect(response.headers.has("Content-Security-Policy")).toBe(true);
    expect(response.headers.has("Content-Security-Policy-Report-Only")).toBe(false);
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src");
  });

  it("always emits enforce header in production", async () => {
    process.env.CSP_HEADER_MODE = "report-only";
    process.env.NODE_ENV = "production";
    process.env.ALLOW_CSP_REPORT_ONLY_IN_UAT = "0";
    const middleware = await loadMiddleware();

    const response = middleware(buildRequest("/sign-in"));

    expect(response.headers.has("Content-Security-Policy")).toBe(true);
    expect(response.headers.has("Content-Security-Policy-Report-Only")).toBe(false);
  });

  it("allows report-only in production only when explicit UAT override is enabled", async () => {
    process.env.CSP_HEADER_MODE = "report-only";
    process.env.NODE_ENV = "production";
    process.env.ALLOW_CSP_REPORT_ONLY_IN_UAT = "1";
    const middleware = await loadMiddleware();

    const response = middleware(buildUatRequest("/sign-in"));

    expect(response.headers.has("Content-Security-Policy-Report-Only")).toBe(true);
    expect(response.headers.has("Content-Security-Policy")).toBe(false);
  });
});
