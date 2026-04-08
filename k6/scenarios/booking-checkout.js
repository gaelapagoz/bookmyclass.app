import { loginWithCredentials } from "../lib/auth.js";
import { pickServiceSeed, pickUserByCohortDeterministic } from "../lib/data.js";
import {
  createDraftWithSessionFallback,
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
  throw new Error("Missing SERVICE_SLUG (env or k6/data/services.json) for booking_checkout scenario.");
}

function resolveSelection(paymentOptionsBody) {
  const paymentOptions = paymentOptionsBody.paymentOptions;
  const forcedPriceId = (__ENV.PRICE_ID || "").trim();

  const singleSession =
    paymentOptions && paymentOptions.singleSession && paymentOptions.singleSession.priceId
      ? String(paymentOptions.singleSession.priceId)
      : "";
  const planPriceIds =
    paymentOptions && Array.isArray(paymentOptions.newPlanOptions)
      ? paymentOptions.newPlanOptions.map((option) => String(option.priceId))
      : [];

  if (forcedPriceId) {
    if (forcedPriceId === singleSession) {
      return { mode: "SINGLE_SESSION", priceId: forcedPriceId };
    }
    if (planPriceIds.includes(forcedPriceId)) {
      return { mode: "NEW_PLAN_PURCHASE", priceId: forcedPriceId };
    }
    throw new Error("PRICE_ID was provided but is not eligible for this booking/payment options payload.");
  }

  const recommended = paymentOptions?.ux?.recommended;
  if (
    recommended &&
    (recommended.mode === "SINGLE_SESSION" || recommended.mode === "NEW_PLAN_PURCHASE") &&
    recommended.priceId
  ) {
    return { mode: recommended.mode, priceId: String(recommended.priceId) };
  }

  if (singleSession) {
    return { mode: "SINGLE_SESSION", priceId: singleSession };
  }

  if (planPriceIds.length > 0) {
    return { mode: "NEW_PLAN_PURCHASE", priceId: planPriceIds[0] };
  }

  throw new Error(
    "booking_checkout requires a SINGLE_SESSION or NEW_PLAN_PURCHASE option. Found none (user may only have entitlement path).",
  );
}

export function bookingCheckoutScenario() {
  const user = pickUserByCohortDeterministic("no_entitlement", {
    offset: 13,
    vuStride: 19,
    iterStride: 23,
  });

  loginWithCredentials(user, { scenario_flow: "booking_checkout" });

  const serviceSlug = resolveServiceSlug();
  const seeded = pickServiceSeed();
  const envSessionId = (__ENV.SESSION_ID || "").trim();
  const maxCandidates = Number(__ENV.BOOKING_SESSION_CANDIDATE_LIMIT || 10);
  const sessionCandidates = envSessionId
    ? [envSessionId]
    : resolveBookingSessionCandidates({
        serviceSlug,
        seed: seeded,
        maxCandidates,
      });
  if (!sessionCandidates.length) {
    throw new Error("No candidate booking sessions available for booking_checkout.");
  }
  const userSessionCandidates = rotateSessionCandidatesForActor(sessionCandidates, {
    actorKey: user.email,
    flowTag: "booking_checkout",
  });

  const draftResult = createDraftWithSessionFallback({
    flowTag: "booking_checkout",
    serviceSlug,
    sessionCandidates: userSessionCandidates,
    refreshCandidates: () =>
      rotateSessionCandidatesForActor(
        resolveBookingSessionCandidates({
          serviceSlug,
          seed: seeded,
          maxCandidates,
        }),
        {
          actorKey: user.email,
          flowTag: "booking_checkout",
        },
      ),
    draftPayload: {
      customerName: user.name || "UAT Client",
      customerEmail: user.email,
      customerPhone: user.phone || "+32000000000",
      customerMessage: "k6 booking checkout flow",
      bookingIntent: "SINGLE_BOOKING",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
    },
  });
  const bookingId = draftResult.bookingId;
  pace();

  const optionsRes = get(`/api/bookings/${encodeURIComponent(bookingId)}/payment-options`, {
    tags: { flow: "booking_checkout", endpoint: "booking_payment_options" },
  });
  assertStatus(optionsRes, 200, "booking_checkout payment options status");
  assertJsonPath(optionsRes, "booking_checkout options payload", (body) => Boolean(body.paymentOptions));

  const selection = resolveSelection(optionsRes.json());
  pace();

  const applyRes = postJson(
    `/api/bookings/${encodeURIComponent(bookingId)}/apply-plan`,
    {
      mode: selection.mode,
      priceId: selection.priceId,
    },
    {
      tags: { flow: "booking_checkout", endpoint: "booking_apply_plan" },
    },
  );
  assertStatus(applyRes, 200, "booking_checkout apply-plan status");
  assertJsonPath(
    applyRes,
    "booking_checkout selection persisted",
    (body) => Boolean(body.selection?.selectedPriceId),
  );

  pace();

  const checkoutRes = postJson(
    "/api/checkout/session",
    {
      bookingId,
    },
    {
      tags: { flow: "booking_checkout", endpoint: "checkout_session" },
    },
  );
  assertStatus(checkoutRes, 200, "booking_checkout checkout session status");
  assertJsonPath(
    checkoutRes,
    "booking_checkout checkout url present",
    (body) => Boolean(body.checkout?.checkoutUrl) && Boolean(body.checkout?.checkoutSessionId),
  );

  pace(0.1, 0.8);
}
