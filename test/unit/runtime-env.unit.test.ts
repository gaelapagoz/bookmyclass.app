import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRuntimeEnv, RuntimeEnvError } from "@/lib/config/runtime-env";

const REQUIRED_PROD_VARS: Record<string, string> = {
  AUTH_SECRET: "secret",
  STRIPE_SECRET_KEY: "sk_live_xxx",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_live_xxx",
  STRIPE_WEBHOOK_SECRET: "whsec_xxx",
  RESEND_API_KEY: "re_xxx",
  EMAIL_FROM: "noreply@bookmyclass.app",
  MARKETING_TRACKING_SECRET: "mts_xxx",
  CRON_SECRET: "cron_xxx",
};

function setProductionEnv(overrides: Partial<typeof REQUIRED_PROD_VARS> = {}) {
  process.env.NODE_ENV = "production";
  Object.entries({ ...REQUIRED_PROD_VARS, ...overrides }).forEach(([key, value]) => {
    if (value === "") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

describe("validateRuntimeEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.E2E_TEST_MODE;
  });

  afterEach(() => {
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, originalEnv);
  });

  it("does not throw in non-production regardless of missing vars", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AUTH_SECRET;
    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it("throws RuntimeEnvError when production + E2E_TEST_MODE=1", () => {
    setProductionEnv();
    process.env.E2E_TEST_MODE = "1";
    expect(() => validateRuntimeEnv()).toThrow(RuntimeEnvError);
    expect(() => validateRuntimeEnv()).toThrow(/E2E_TEST_MODE/);
  });

  it("allows E2E test mode for local isolated E2E runtime", () => {
    setProductionEnv({ MARKETING_TRACKING_SECRET: "", CRON_SECRET: "" });
    process.env.E2E_TEST_MODE = "1";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/studio_e2e_test";
    process.env.APP_URL = "http://127.0.0.1:3100";

    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it("refuses E2E test mode when the database is not an E2E database", () => {
    setProductionEnv();
    process.env.E2E_TEST_MODE = "1";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/studio_dev";
    process.env.APP_URL = "http://127.0.0.1:3100";

    expect(() => validateRuntimeEnv()).toThrow(/E2E_TEST_MODE/);
  });

  it("passes when all required production vars are present", () => {
    setProductionEnv();
    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it.each(Object.keys(REQUIRED_PROD_VARS))(
    "throws when production is missing %s",
    (missingVar) => {
      setProductionEnv({ [missingVar]: "" });
      expect(() => validateRuntimeEnv()).toThrow(RuntimeEnvError);
      expect(() => validateRuntimeEnv()).toThrow(missingVar);
    },
  );
});
