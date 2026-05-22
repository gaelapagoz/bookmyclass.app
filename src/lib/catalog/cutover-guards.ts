export type CatalogCutoverGuards = {
  validatorEnforced: true;
  backfillWritesEnabled: true;
  legacyFlagsRemoved: true;
};

export type CatalogPreflightValidatorState = {
  isGreen: boolean;
};

export function resolveCatalogCutoverGuards(): CatalogCutoverGuards {
  return {
    validatorEnforced: true,
    backfillWritesEnabled: true,
    legacyFlagsRemoved: true,
  };
}

export function assertCatalogCutoverCanProceed(input: {
  guards: CatalogCutoverGuards;
  validator: CatalogPreflightValidatorState;
}): void {
  if (input.guards.validatorEnforced && !input.validator.isGreen) {
    throw new Error("CATALOG_CUTOVER_VALIDATOR_FAILED");
  }
}
