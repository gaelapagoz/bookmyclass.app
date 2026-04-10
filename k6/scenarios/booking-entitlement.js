import { loginWithCredentials } from "../lib/auth.js";
import { pickServiceSeed, pickUserByCohortDeterministic } from "../lib/data.js";
import {
  createDraftWithSessionFallback,
  resolveEntitlementPrefilter,
  resolveBookingSessionCandidates,
  rotateSessionCandidatesForActor,
} from "../lib/booking-candidates.js";
import { get, postJson } from "../lib/http.js";
import { assertJsonPath, assertStatus } from "../lib/checks.js";
import { pace } from "../lib/pacing.js";

function resolveServiceSlug() {
  const envSlug = (__ENV.SERVICE_SLUG || "").trim();
  if (envSlug) {
    return envSlug;
  }
  const seeded = pickServiceSeed();
  if (seeded?.serviceSlug) {
    return String(seeded.serviceSlug);
  }
  throw new Error("Missing SERVICE_SLUG (env or k6/data/services.json) for booking_entitlement scenario.");
}

export function bookingEntitlementScenario() {
  const user = pickUserByCohortDeterministic("entitlement_collective", {
    offset: 31,
    vuStride: 17,
    iterStride: 29,
  });

  loginWithCredentials(user, { scenario_flow: "booking_entitlement" });

  const serviceSlug = resolveServiceSlug();
  const entitlementPrefilter = resolveEntitlementPrefilter({
    flowTag: "booking_entitlement",
    serviceSlug,
  });
  if (!entitlementPrefilter.eligible) {
    pace(0.05, 0.2);
    return;
  }

  const seeded = pickServiceSeed();
  const envSessionId = (__ENV.SESSION_ID || "").trim();
  const maxCandidates = Number(__ENV.BOOKING_SESSION_CANDIDATE_LIMIT || 10);
  const sessionCandidates = envSessionId
    ? [envSessionId]
    : resolveBookingSessionCandidates({
        flowTag: "booking_entitlement",
        serviceSlug,
        seed: seeded,
        maxCandidates,
      });
  if (!sessionCandidates.length) {
    throw new Error("No candidate booking sessions available for booking_entitlement.");
  }
  const userSessionCandidates = rotateSessionCandidatesForActor(sessionCandidates, {
    actorKey: user.email,
    flowTag: "booking_entitlement",
  });

  const draftResult = createDraftWithSessionFallback({
    flowTag: "booking_entitlement",
    serviceSlug,
    sessionCandidates: userSessionCandidates,
    refreshCandidates: () =>
      rotateSessionCandidatesForActor(
        resolveBookingSessionCandidates({
          flowTag: "booking_entitlement",
          serviceSlug,
          seed: seeded,
          maxCandidates,
        }),
        {
          actorKey: user.email,
          flowTag: "booking_entitlement",
        },
      ),
    draftPayload: {
      customerName: user.name || "UAT Client",
      customerEmail: user.email,
      customerPhone: user.phone || "+32000000000",
      customerMessage: "k6 booking entitlement flow",
      bookingIntent: "USE_PLAN",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
    },
  });
  const bookingId = draftResult.bookingId;
  pace();

  const optionsRes = get(`/api/bookings/${encodeURIComponent(bookingId)}/payment-options`, {
    tags: { flow: "booking_entitlement", endpoint: "booking_payment_options" },
  });
  assertStatus(optionsRes, 200, "booking_entitlement payment options status");
  assertJsonPath(optionsRes, "booking_entitlement options payload", (body) => Boolean(body.paymentOptions));
  const optionsBody = optionsRes.json();
  const entitlementId =
    optionsBody &&
    optionsBody.paymentOptions &&
    Array.isArray(optionsBody.paymentOptions.existingPlans) &&
    optionsBody.paymentOptions.existingPlans[0]?.entitlementId
      ? String(optionsBody.paymentOptions.existingPlans[0].entitlementId)
      : "";

  if (!entitlementId) {
    throw new Error(
      "booking_entitlement requires at least one active existing plan for the test user. None found in payment options.",
    );
  }

  pace();

  const applyRes = postJson(
    `/api/bookings/${encodeURIComponent(bookingId)}/apply-plan`,
    {
      mode: "EXISTING_PLAN",
      entitlementId,
    },
    {
      tags: { flow: "booking_entitlement", endpoint: "booking_apply_plan" },
    },
  );
  assertStatus(applyRes, 200, "booking_entitlement apply-plan status");
  assertJsonPath(
    applyRes,
    "booking_entitlement confirms booking",
    (body) => body.selection?.bookingStatus === "CONFIRMED",
  );

  pace(0.1, 0.8);
}
