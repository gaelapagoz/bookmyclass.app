export type CatalogCutoverFlags = {
  dbOnlyCheckoutEnabled: boolean;
  rollbackArmed: boolean;
  preCutoverValidatorEnforced: boolean;
  backfillWritesEnabled: boolean;
};

export type CatalogCutoverValidatorState = {
  isGreen: boolean;
};

function parseBooleanFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function resolveCatalogCutoverFlags(env: NodeJS.ProcessEnv = process.env): CatalogCutoverFlags {
  const rollbackArmed = parseBooleanFlag(env.CATALOG_CUTOVER_ROLLBACK_MODE);

  return {
    dbOnlyCheckoutEnabled: parseBooleanFlag(env.CATALOG_DB_ONLY_CHECKOUT_ENABLED),
    rollbackArmed,
    preCutoverValidatorEnforced: env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED
      ? parseBooleanFlag(env.CATALOG_PRE_CUTOVER_VALIDATOR_ENFORCED)
      : true,
    backfillWritesEnabled: parseBooleanFlag(env.CATALOG_BACKFILL_WRITES_ENABLED ?? "1") && !rollbackArmed,
  };
}

export function assertCatalogCutoverCanProceed(input: {
  flags: CatalogCutoverFlags;
  validator: CatalogCutoverValidatorState;
}): void {
  if (input.flags.rollbackArmed) {
    throw new Error("CATALOG_CUTOVER_ROLLBACK_ARMED");
  }

  if (!input.flags.dbOnlyCheckoutEnabled) {
    throw new Error("CATALOG_CUTOVER_FLAG_DISABLED");
  }

  if (input.flags.preCutoverValidatorEnforced && !input.validator.isGreen) {
    throw new Error("CATALOG_CUTOVER_VALIDATOR_FAILED");
  }
}
