import { createThresholds } from "./config/thresholds.js";
import { buildArrivalConfig, getSupportedStageProfiles, resolveStageProfile } from "./config/stages.js";
import { getBaseUrl } from "./lib/http.js";
import { users } from "./lib/data.js";
import { browseScenario } from "./scenarios/browse.js";
import { loginScenario } from "./scenarios/login.js";
import { bookingEntitlementScenario } from "./scenarios/booking-entitlement.js";
import { bookingCheckoutScenario } from "./scenarios/booking-checkout.js";
import { subscriptionCheckoutScenario } from "./scenarios/subscription-checkout.js";

const stageProfile = resolveStageProfile();
const SCENARIO_SETS = {
  full_smoke: [
    "browse",
    "login",
    "booking_entitlement",
    "booking_checkout",
    "subscription_checkout",
  ],
  non_booking_smoke: ["browse", "login", "subscription_checkout"],
  booking_only_smoke: ["booking_entitlement", "booking_checkout"],
};

function getSupportedScenarioSets() {
  return Object.keys(SCENARIO_SETS);
}

function resolveScenarioSet() {
  const requested = (__ENV.K6_SCENARIO_SET || "full_smoke").trim().toLowerCase();
  if (!SCENARIO_SETS[requested]) {
    throw new Error(
      `Unsupported K6_SCENARIO_SET='${requested}'. Supported scenario sets: ${getSupportedScenarioSets().join(",")}`,
    );
  }
  return requested;
}

const scenarioSet = resolveScenarioSet();
const arrivalConfigOptions = { scenarioSet };

const allScenarios = {
  browse: {
    executor: "ramping-arrival-rate",
    exec: "browse",
    tags: { scenario_type: "browse" },
    ...buildArrivalConfig(stageProfile, "browse", arrivalConfigOptions),
  },
  login: {
    executor: "ramping-arrival-rate",
    exec: "login",
    tags: { scenario_type: "login" },
    ...buildArrivalConfig(stageProfile, "login", arrivalConfigOptions),
  },
  booking_entitlement: {
    executor: "ramping-arrival-rate",
    exec: "booking_entitlement",
    tags: { scenario_type: "booking_entitlement" },
    ...buildArrivalConfig(stageProfile, "booking_entitlement", arrivalConfigOptions),
  },
  booking_checkout: {
    executor: "ramping-arrival-rate",
    exec: "booking_checkout",
    tags: { scenario_type: "booking_checkout" },
    ...buildArrivalConfig(stageProfile, "booking_checkout", arrivalConfigOptions),
  },
  subscription_checkout: {
    executor: "ramping-arrival-rate",
    exec: "subscription_checkout",
    tags: { scenario_type: "subscription_checkout" },
    ...buildArrivalConfig(stageProfile, "subscription_checkout", arrivalConfigOptions),
  },
};

function filterScenariosForSet(setName) {
  const enabledScenarios = SCENARIO_SETS[setName];
  return Object.fromEntries(
    Object.entries(allScenarios).filter(([scenarioName]) => enabledScenarios.includes(scenarioName)),
  );
}

export const options = {
  discardResponseBodies: false,
  thresholds: createThresholds(),
  scenarios: filterScenariosForSet(scenarioSet),
};

function ensureSeedUsers() {
  if (!users.length) {
    throw new Error(
      "k6/data/users.csv is empty. Add seeded UAT users with fields: email,password,name,phone",
    );
  }
}

export function setup() {
  const baseUrl = getBaseUrl();
  ensureSeedUsers();
  console.log(
    `k6 setup complete. BASE_URL=${baseUrl} STAGE_PROFILE=${stageProfile} K6_SCENARIO_SET=${scenarioSet} SupportedProfiles=${getSupportedStageProfiles().join(",")} SupportedScenarioSets=${getSupportedScenarioSets().join(",")}`,
  );
}

export function browse() {
  browseScenario();
}

export function login() {
  loginScenario();
}

export function booking_entitlement() {
  bookingEntitlementScenario();
}

export function booking_checkout() {
  bookingCheckoutScenario();
}

export function subscription_checkout() {
  subscriptionCheckoutScenario();
}
