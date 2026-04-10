import { loginWithCredentials } from "../lib/auth.js";
import { pickProductSeed, pickUserByCohort } from "../lib/data.js";
import { get, postJson } from "../lib/http.js";
import { assertJsonPath, assertStatus } from "../lib/checks.js";
import { pace } from "../lib/pacing.js";
import { Counter } from "k6/metrics";

const subscriptionCheckoutInvalidProductSkipTotal = new Counter("subscription_checkout_invalid_product_skip_total");
const invalidResolvedProductIds = new Set();
let cachedResolvedProductId = "";

function listLiveProductIds() {
  const envProductId = (__ENV.PRODUCT_ID || "").trim();
  const seeded = pickProductSeed();

  const plansRes = get("/api/subscription/plans", {
    tags: { flow: "subscription_checkout", endpoint: "subscription_plans" },
  });
  assertStatus(plansRes, 200, "subscription_checkout plans status");
  assertJsonPath(plansRes, "subscription_checkout plans payload", (body) => Array.isArray(body.products));

  const plansBody = plansRes.json();
  const liveProductIds = plansBody && Array.isArray(plansBody.products)
    ? plansBody.products
        .map((product) => (product?.productId ? String(product.productId).trim() : ""))
        .filter((productId) => productId.length > 0)
    : [];

  const prioritized = [];
  if (envProductId) {
    prioritized.push(envProductId);
  }
  if (seeded?.productId) {
    prioritized.push(String(seeded.productId));
  }

  for (const liveProductId of [...liveProductIds].sort((left, right) => left.localeCompare(right))) {
    prioritized.push(liveProductId);
  }

  const deduped = [];
  const seen = new Set();
  for (const productId of prioritized) {
    const normalized = String(productId || "").trim();
    if (!normalized || seen.has(normalized) || invalidResolvedProductIds.has(normalized)) {
      continue;
    }
    deduped.push(normalized);
    seen.add(normalized);
  }

  if (!deduped.length) {
    throw new Error("No productId available for subscription checkout (env/data/plans fallback all empty).");
  }

  return deduped;
}

function resolveProductId(forceLiveResolve = false) {
  if (!forceLiveResolve && cachedResolvedProductId && !invalidResolvedProductIds.has(cachedResolvedProductId)) {
    return cachedResolvedProductId;
  }

  const candidates = listLiveProductIds();
  cachedResolvedProductId = candidates[0];
  return cachedResolvedProductId;
}

function isInvalidProductResponse(response, body) {
  if (!response || response.status !== 404) {
    return false;
  }

  const code = body && body.code ? String(body.code) : "";
  const error = body && body.error ? String(body.error) : "";
  return code === "PRODUCT_NOT_FOUND" || /product not found/i.test(error);
}

export function subscriptionCheckoutScenario() {
  const user = pickUserByCohort("subscription_buyer");
  loginWithCredentials(user, { scenario_flow: "subscription_checkout" });

  let productId = resolveProductId();
  pace();

  let checkoutRes = postJson(
    "/api/subscription/checkout",
    { productId },
    { tags: { flow: "subscription_checkout", endpoint: "subscription_checkout" } },
  );

  let checkoutBody = checkoutRes.json();
  if (isInvalidProductResponse(checkoutRes, checkoutBody)) {
    subscriptionCheckoutInvalidProductSkipTotal.add(1, { flow: "subscription_checkout" });
    invalidResolvedProductIds.add(productId);
    cachedResolvedProductId = "";

    productId = resolveProductId(true);
    checkoutRes = postJson(
      "/api/subscription/checkout",
      { productId },
      { tags: { flow: "subscription_checkout", endpoint: "subscription_checkout" } },
    );
    checkoutBody = checkoutRes.json();

    if (isInvalidProductResponse(checkoutRes, checkoutBody)) {
      subscriptionCheckoutInvalidProductSkipTotal.add(1, { flow: "subscription_checkout" });
      invalidResolvedProductIds.add(productId);
      cachedResolvedProductId = "";
      pace(0.05, 0.2);
      return;
    }
  }

  assertStatus(checkoutRes, 200, "subscription_checkout status");
  assertJsonPath(
    checkoutRes,
    "subscription_checkout url present",
    (body) => Boolean(body.checkoutUrl) && Boolean(body.checkoutSessionId),
  );

  pace(0.1, 0.8);
}
