import { loginWithCredentials } from "../lib/auth.js";
import { pickSeedSessionId, pickServiceSeed, pickUserByCohortDeterministic } from "../lib/data.js";
import { get, postJson } from "../lib/http.js";
import { assertJsonPath, assertStatus } from "../lib/checks.js";
import { pace } from "../lib/pacing.js";

function dateKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function resolveSessionId(serviceSlug) {
  const envSessionId = (__ENV.SESSION_ID || "").trim();
  if (envSessionId) {
    return envSessionId;
  }

  const seeded = pickServiceSeed();
  const pooled = pickSeedSessionId(seeded, {
    offset: 29,
    vuStride: 9,
    iterStride: 7,
  });
  if (pooled) {
    return pooled;
  }

  const fromDate = dateKeyFrom(new Date());
  const nextRes = get(
    `/api/services/${encodeURIComponent(serviceSlug)}/next-availability?from=${encodeURIComponent(fromDate)}`,
    { tags: { flow: "booking_entitlement", endpoint: "service_next_availability" } },
  );
  assertStatus(nextRes, 200, "booking_entitlement next availability status");
  const nextBody = nextRes.json();
  const nextDate = nextBody && nextBody.next && nextBody.next.date ? String(nextBody.next.date) : "";
  if (!nextDate) {
    throw new Error("No upcoming availability found to resolve SESSION_ID for booking_entitlement.");
  }

  const slotsRes = get(`/api/services/${encodeURIComponent(serviceSlug)}/slots?date=${encodeURIComponent(nextDate)}`, {
    tags: { flow: "booking_entitlement", endpoint: "service_slots" },
  });
  assertStatus(slotsRes, 200, "booking_entitlement slots status");
  const slotsBody = slotsRes.json();
  const firstAvailableSlot =
    slotsBody && Array.isArray(slotsBody.slots) ? slotsBody.slots.find((slot) => Boolean(slot.isAvailable)) : null;
  if (!firstAvailableSlot || !firstAvailableSlot.id) {
    throw new Error("No available session slot found to resolve SESSION_ID for booking_entitlement.");
  }
  return String(firstAvailableSlot.id);
}

export function bookingEntitlementScenario() {
  const user = pickUserByCohortDeterministic("entitlement_collective", {
    offset: 31,
    vuStride: 17,
    iterStride: 29,
  });

  loginWithCredentials(user, { scenario_flow: "booking_entitlement" });

  const serviceSlug = resolveServiceSlug();
  const sessionId = resolveSessionId(serviceSlug);

  const draftRes = postJson(
    "/api/bookings/draft",
    {
      serviceSlug,
      sessionId,
      customerName: user.name || "UAT Client",
      customerEmail: user.email,
      customerPhone: user.phone || "+32000000000",
      customerMessage: "k6 booking entitlement flow",
      bookingIntent: "USE_PLAN",
      consentTermsAccepted: true,
      consentPrivacyAccepted: true,
    },
    {
      tags: { flow: "booking_entitlement", endpoint: "booking_draft" },
    },
  );

  assertStatus(draftRes, 201, "booking_entitlement draft created");
  assertJsonPath(draftRes, "booking_entitlement draft id present", (body) => Boolean(body.draft?.bookingId));
  const bookingId = String(draftRes.json().draft.bookingId);
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
