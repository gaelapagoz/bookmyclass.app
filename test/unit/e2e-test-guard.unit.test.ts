import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertE2ETestRequest, isE2ETestModeEnabled } from "@/lib/e2e/e2e-test-guard";

const E2E_SECRET_HEADER = "x-e2e-test-secret";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/test/e2e/verify-email", { headers });
}

describe("isE2ETestModeEnabled", () => {
  it("returns false when E2E_TEST_MODE is unset", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_TEST_MODE", "");
    expect(isE2ETestModeEnabled()).toBe(false);
  });

  it("returns true when E2E_TEST_MODE is '1' outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect(isE2ETestModeEnabled()).toBe(true);
  });

  it("returns false when E2E_TEST_MODE is '1' in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect(isE2ETestModeEnabled()).toBe(false);
  });
});

describe("assertE2ETestRequest", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when E2E_TEST_MODE is not enabled", () => {
    vi.stubEnv("E2E_TEST_MODE", "");
    vi.stubEnv("E2E_TEST_SECRET", "secret");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "secret" }));

    expect(result?.status).toBe(404);
  });

  it("returns 401 when E2E_TEST_SECRET env var is not set", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "" }));

    expect(result?.status).toBe(401);
  });

  it("returns 401 when E2E_TEST_SECRET env var is whitespace only", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "   ");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "   " }));

    expect(result?.status).toBe(401);
  });

  it("returns 401 when request header is missing", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "my-secret");

    const result = assertE2ETestRequest(makeRequest());

    expect(result?.status).toBe(401);
  });

  it("returns 401 when request header does not match secret", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "my-secret");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "wrong-secret" }));

    expect(result?.status).toBe(401);
  });

  it("returns null (pass-through) when secret matches", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "my-secret");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "my-secret" }));

    expect(result).toBeNull();
  });

  it("trims whitespace from both secret and header before comparing", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("E2E_TEST_SECRET", "  my-secret  ");

    const result = assertE2ETestRequest(makeRequest({ [E2E_SECRET_HEADER]: "  my-secret  " }));

    expect(result).toBeNull();
  });
});
