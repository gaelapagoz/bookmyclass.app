import { describe, expect, it } from "vitest";

import {
  type SameOriginValidationInput,
  buildSameOriginValidationInputFromHeaders,
  validateSameOrigin,
  validateSameOriginFromHeaders,
} from "../../src/lib/security/same-origin";

function createInput(overrides: Partial<SameOriginValidationInput> = {}): SameOriginValidationInput {
  return {
    originHeader: "https://uat.bookmyclass.app",
    refererHeader: null,
    forwardedHostHeader: "uat.bookmyclass.app",
    hostHeader: null,
    forwardedProtoHeader: "https",
    appUrl: "https://uat.bookmyclass.app",
    ...overrides,
  };
}

describe("same-origin validation", () => {
  it("accepts matching origin", () => {
    const result = validateSameOrigin(createInput());
    expect(result.ok).toBe(true);
    expect(result.providedOrigin).toBe("https://uat.bookmyclass.app");
  });

  it("falls back to referer when origin is missing", () => {
    const result = validateSameOrigin(
      createInput({
        originHeader: null,
        refererHeader: "https://uat.bookmyclass.app/sign-in?callbackUrl=%2Fdashboard",
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.providedOrigin).toBe("https://uat.bookmyclass.app");
  });

  it("rejects mismatched origin", () => {
    const result = validateSameOrigin(createInput({ originHeader: "https://evil.example" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Origin mismatch");
  });

  it("accepts localhost http origin when forwarded proto is missing", () => {
    const result = validateSameOrigin(
      createInput({
        originHeader: "http://localhost:3000",
        forwardedHostHeader: "localhost:3000",
        forwardedProtoHeader: null,
        appUrl: null,
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.providedOrigin).toBe("http://localhost:3000");
  });

  it("rejects when both origin and referer are missing", () => {
    const result = validateSameOrigin(
      createInput({
        originHeader: null,
        refererHeader: null,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Missing both Origin and Referer");
  });

  it("rejects when no allowed origins can be resolved", () => {
    const result = validateSameOrigin(
      createInput({
        forwardedHostHeader: null,
        hostHeader: null,
        appUrl: null,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("No allowed same-origin values");
  });

  it("builds pure input from headers and validates", () => {
    const headers = new Headers({
      origin: "https://uat.bookmyclass.app",
      "x-forwarded-host": "uat.bookmyclass.app",
      "x-forwarded-proto": "https",
    });

    const input = buildSameOriginValidationInputFromHeaders(headers, "https://uat.bookmyclass.app");
    expect(input.forwardedHostHeader).toBe("uat.bookmyclass.app");

    const result = validateSameOriginFromHeaders(headers, "https://uat.bookmyclass.app");
    expect(result.ok).toBe(true);
  });
});
