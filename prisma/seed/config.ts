export type SeedMode = "development" | "uat-performance" | "production";

const VALID_SEED_MODES: SeedMode[] = ["development", "uat-performance", "production"];

const PRODUCTION_CONFIRM_VALUE = "bookmyclass-prod-seed";

// Patterns in DATABASE_URL that indicate a production environment.
// Used to block dev/uat-perf seeds from running against production.
const PRODUCTION_URL_INDICATORS = ["46.62.208.152", "bookmyclass-app-postgres"];

// Patterns in DATABASE_URL that indicate a non-production environment.
// Used to block the production seed from running against dev/test/UAT.
const NON_PRODUCTION_URL_INDICATORS = ["localhost", "127.0.0.1", "uat", "staging", "-test", "_test", ".test"];

export function resolveSeedMode(): SeedMode {
  const raw = process.env.BOOKMYCLASS_SEED_MODE?.trim();
  if (!raw) {
    throw new Error(
      "BOOKMYCLASS_SEED_MODE is not set. Valid values: development | uat-performance | production",
    );
  }
  if (!VALID_SEED_MODES.includes(raw as SeedMode)) {
    throw new Error(
      `Invalid BOOKMYCLASS_SEED_MODE="${raw}". Valid values: ${VALID_SEED_MODES.join(" | ")}`,
    );
  }
  return raw as SeedMode;
}

export function validateEnvironmentForMode(mode: SeedMode, databaseUrl: string): void {
  const urlLower = databaseUrl.toLowerCase();

  if (mode === "production") {
    // 1. Require explicit confirmation string.
    const confirmValue = process.env.CONFIRM_PRODUCTION_SEED?.trim();
    if (confirmValue !== PRODUCTION_CONFIRM_VALUE) {
      throw new Error(
        `Production seed refused: CONFIRM_PRODUCTION_SEED must equal "${PRODUCTION_CONFIRM_VALUE}". ` +
          `Got: "${confirmValue ?? "(not set)"}"`,
      );
    }

    // 2. Refuse in test environments.
    if (process.env.NODE_ENV === "test") {
      throw new Error("Production seed refused: NODE_ENV is 'test'.");
    }


    console.info("[seed] Production safety checks passed.");
  } else {
    // dev / uat-performance — refuse to run against production.
    for (const indicator of PRODUCTION_URL_INDICATORS) {
      if (urlLower.includes(indicator)) {
        throw new Error(
          `${mode} seed refused: DATABASE_URL appears to be a production database (contains '${indicator}'). ` +
            "This seed mode must not run against production.",
        );
      }
    }
  }
}

export {
  PRODUCTION_CONFIRM_VALUE,
  PRODUCTION_URL_INDICATORS,
  NON_PRODUCTION_URL_INDICATORS,
  VALID_SEED_MODES,
};
