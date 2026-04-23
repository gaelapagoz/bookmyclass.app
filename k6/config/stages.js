const PROFILE_TOTAL_RATES = {
  smoke: 20,
  smoke_booking_safe: 13,
  t50: 50,
  t100: 100,
};

const DEPRECATED_PROFILE_ALIASES = {
  t100_5m: "t100",
  t250: "t100",
  t250_5m: "t100",
  t500: "t100",
  t750: "t100",
  t1000: "t100",
  soak1000: "t100",
};

const PROFILE_STAGE_BUILDERS = {
  smoke: (rate) => [
    { duration: "1m", target: Math.max(1, Math.round(rate * 0.5)) },
    { duration: "3m", target: Math.max(1, rate) },
    { duration: "1m", target: 0 },
  ],
  smoke_booking_safe: (rate) => [
    { duration: "1m", target: Math.max(1, Math.round(rate * 0.5)) },
    { duration: "3m", target: Math.max(1, rate) },
    { duration: "1m", target: 0 },
  ],
  t50: (rate) => [
    { duration: "1m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "3m", target: Math.max(1, rate) },
    { duration: "1m", target: 0 },
  ],
  t100: (rate) => [
    { duration: "5m", target: Math.max(1, Math.round(rate * 0.6)) },
    { duration: "10m", target: Math.max(1, rate) },
    { duration: "5m", target: 0 },
  ],
};

const SCENARIO_WEIGHTS = {
  browse: 0.35,
  login: 0.2,
  booking_entitlement: 0.2,
  booking_checkout: 0.15,
  subscription_checkout: 0.1,
};

const PROFILE_SCENARIO_RATE_OVERRIDES = {
  smoke_booking_safe: {
    browse: 6,
    login: 3,
    booking_entitlement: 1,
    booking_checkout: 1,
    subscription_checkout: 2,
  },
};

export function getSupportedStageProfiles() {
  return [...Object.keys(PROFILE_TOTAL_RATES), ...Object.keys(DEPRECATED_PROFILE_ALIASES)];
}

function normalizeStageProfile(profileName) {
  return DEPRECATED_PROFILE_ALIASES[profileName] || profileName;
}

export function resolveStageProfile() {
  const requested = (__ENV.STAGE_PROFILE || "smoke").trim().toLowerCase();
  const normalized = normalizeStageProfile(requested);
  if (!PROFILE_TOTAL_RATES[normalized]) {
    throw new Error(
      `Unsupported STAGE_PROFILE='${requested}'. Supported profiles: ${getSupportedStageProfiles().join(", ")}`,
    );
  }
  return normalized;
}

export function buildScenarioRate(profileName, scenarioName) {
  const normalizedProfileName = normalizeStageProfile(profileName);
  const profileOverrides = PROFILE_SCENARIO_RATE_OVERRIDES[profileName];
  if (profileOverrides?.[scenarioName]) {
    return profileOverrides[scenarioName];
  }

  const totalRate = PROFILE_TOTAL_RATES[normalizedProfileName];
  const weight = SCENARIO_WEIGHTS[scenarioName];
  if (!totalRate || !weight) {
    throw new Error(`Could not calculate scenario rate for profile='${profileName}', scenario='${scenarioName}'.`);
  }

  return Math.max(1, Math.round(totalRate * weight));
}

export function buildScenarioStages(profileName, scenarioName) {
  const normalizedProfileName = normalizeStageProfile(profileName);
  const rate = buildScenarioRate(normalizedProfileName, scenarioName);
  const builder = PROFILE_STAGE_BUILDERS[normalizedProfileName];
  if (!builder) {
    throw new Error(`Missing stage builder for profile='${profileName}'.`);
  }
  return builder(rate);
}

function isBookingScenario(scenarioName) {
  return scenarioName === "booking_entitlement" || scenarioName === "booking_checkout";
}

function shouldUseBookingSafeArrival(profileName, scenarioName, scenarioSet) {
  return (
    profileName === "smoke_booking_safe" &&
    isBookingScenario(scenarioName) &&
    (scenarioSet === "booking_only_smoke" || scenarioSet === "full_smoke")
  );
}

export function buildArrivalConfig(profileName, scenarioName, options = {}) {
  if (shouldUseBookingSafeArrival(profileName, scenarioName, options.scenarioSet)) {
    return {
      startRate: 1,
      timeUnit: "1m",
      preAllocatedVUs: 10,
      maxVUs: 20,
      stages: [
        { duration: "1m", target: 2 },
        { duration: "3m", target: 4 },
        { duration: "1m", target: 0 },
      ],
    };
  }

  const scenarioRate = buildScenarioRate(profileName, scenarioName);
  return {
    startRate: Math.max(1, Math.round(scenarioRate * 0.5)),
    timeUnit: "1s",
    preAllocatedVUs: Math.max(10, Math.round(scenarioRate * 1.5)),
    maxVUs: Math.max(20, Math.round(scenarioRate * 3)),
    stages: buildScenarioStages(profileName, scenarioName),
  };
}
