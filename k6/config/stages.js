const PROFILE_TOTAL_RATES = {
  smoke: 20,
  t100: 100,
  t250: 250,
  t500: 500,
  t750: 750,
  t1000: 1000,
  soak1000: 1000,
};

const PROFILE_STAGE_BUILDERS = {
  smoke: (rate) => [
    { duration: "1m", target: Math.max(1, Math.round(rate * 0.5)) },
    { duration: "3m", target: Math.max(1, rate) },
    { duration: "1m", target: 0 },
  ],
  t100: (rate) => [
    { duration: "5m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "10m", target: Math.max(1, rate) },
    { duration: "5m", target: 0 },
  ],
  t250: (rate) => [
    { duration: "5m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "15m", target: Math.max(1, rate) },
    { duration: "5m", target: 0 },
  ],
  t500: (rate) => [
    { duration: "8m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "20m", target: Math.max(1, rate) },
    { duration: "7m", target: 0 },
  ],
  t750: (rate) => [
    { duration: "10m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "25m", target: Math.max(1, rate) },
    { duration: "10m", target: 0 },
  ],
  t1000: (rate) => [
    { duration: "12m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "30m", target: Math.max(1, rate) },
    { duration: "12m", target: 0 },
  ],
  soak1000: (rate) => [
    { duration: "15m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "2h", target: Math.max(1, rate) },
    { duration: "15m", target: 0 },
  ],
};

const SCENARIO_WEIGHTS = {
  browse: 0.35,
  login: 0.2,
  booking_entitlement: 0.2,
  booking_checkout: 0.15,
  subscription_checkout: 0.1,
};

export function getSupportedStageProfiles() {
  return Object.keys(PROFILE_TOTAL_RATES);
}

export function resolveStageProfile() {
  const requested = (__ENV.STAGE_PROFILE || "smoke").trim().toLowerCase();
  if (!PROFILE_TOTAL_RATES[requested]) {
    throw new Error(
      `Unsupported STAGE_PROFILE='${requested}'. Supported profiles: ${getSupportedStageProfiles().join(", ")}`,
    );
  }
  return requested;
}

export function buildScenarioRate(profileName, scenarioName) {
  const totalRate = PROFILE_TOTAL_RATES[profileName];
  const weight = SCENARIO_WEIGHTS[scenarioName];
  if (!totalRate || !weight) {
    throw new Error(`Could not calculate scenario rate for profile='${profileName}', scenario='${scenarioName}'.`);
  }

  return Math.max(1, Math.round(totalRate * weight));
}

export function buildScenarioStages(profileName, scenarioName) {
  const rate = buildScenarioRate(profileName, scenarioName);
  const builder = PROFILE_STAGE_BUILDERS[profileName];
  if (!builder) {
    throw new Error(`Missing stage builder for profile='${profileName}'.`);
  }
  return builder(rate);
}

export function buildArrivalConfig(profileName, scenarioName) {
  const scenarioRate = buildScenarioRate(profileName, scenarioName);
  return {
    startRate: Math.max(1, Math.round(scenarioRate * 0.5)),
    timeUnit: "1s",
    preAllocatedVUs: Math.max(10, Math.round(scenarioRate * 1.5)),
    maxVUs: Math.max(20, Math.round(scenarioRate * 3)),
    stages: buildScenarioStages(profileName, scenarioName),
  };
}

