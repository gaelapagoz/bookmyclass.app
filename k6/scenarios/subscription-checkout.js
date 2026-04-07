import { loginWithCredentials } from "../lib/auth.js";
import { pickProductSeed, pickUserByCohort } from "../lib/data.js";
import { get, postJson } from "../lib/http.js";
import { assertJsonPath, assertStatus } from "../lib/checks.js";
import { pace } from "../lib/pacing.js";

function resolveProductId() {
  const envProductId = (__ENV.PRODUCT_ID || "").trim();
  if (envProductId) {
    return envProductId;
  }

  const seeded = pickProductSeed();
  if (seeded?.productId) {
    return String(seeded.productId);
  }

  const plansRes = get("/api/subscription/plans", {
    tags: { flow: "subscription_checkout", endpoint: "subscription_plans" },
  });
  assertStatus(plansRes, 200, "subscription_checkout plans status");
  assertJsonPath(plansRes, "subscription_checkout plans payload", (body) => Array.isArray(body.products));

  const plansBody = plansRes.json();
  const firstProductId =
    plansBody && Array.isArray(plansBody.products) && plansBody.products[0]?.productId
      ? String(plansBody.products[0].productId)
      : "";

  if (!firstProductId) {
    throw new Error("No productId available for subscription checkout (env/data/plans fallback all empty).");
  }

  return firstProductId;
}

export function subscriptionCheckoutScenario() {
  const user = pickUserByCohort("subscription_buyer");
  loginWithCredentials(user, { scenario_flow: "subscription_checkout" });

  const productId = resolveProductId();
  pace();

  const checkoutRes = postJson(
    "/api/subscription/checkout",
    {
      productId,
    },
    {
      tags: { flow: "subscription_checkout", endpoint: "subscription_checkout" },
    },
  );

  assertStatus(checkoutRes, 200, "subscription_checkout status");
  assertJsonPath(
    checkoutRes,
    "subscription_checkout url present",
    (body) => Boolean(body.checkoutUrl) && Boolean(body.checkoutSessionId),
  );

  pace(0.1, 0.8);
}
