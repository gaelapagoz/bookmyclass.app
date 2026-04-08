import { get, postJson } from "./http.js";

function dateKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeSeedSessionIds(seed) {
  if (!seed) {
    return [];
  }

  if (Array.isArray(seed.sessionIds)) {
    return seed.sessionIds
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0);
  }

  if (seed.sessionId) {
    const single = String(seed.sessionId).trim();
    return single ? [single] : [];
  }

  return [];
}

function normalizeIndex(value, size) {
  if (size <= 0) {
    return 0;
  }
  return ((value % size) + size) % size;
}

function collectSeedSessionCandidates(seed, maxCandidates) {
  const sessionIds = normalizeSeedSessionIds(seed);
  if (!sessionIds.length || maxCandidates <= 0) {
    return [];
  }

  const startIndex = normalizeIndex(Math.max(0, Number(__VU) - 1) * 11 + Math.max(0, Number(__ITER)) * 7, sessionIds.length);
  const candidates = [];
  for (let offset = 0; offset < sessionIds.length && candidates.length < maxCandidates; offset += 1) {
    const index = normalizeIndex(startIndex + offset, sessionIds.length);
    candidates.push(sessionIds[index]);
  }
  return candidates;
}

function collectNearestAvailabilityCandidates(serviceSlug) {
  const fromDate = dateKeyFrom(new Date());
  const nextRes = get(
    `/api/services/${encodeURIComponent(serviceSlug)}/next-availability?from=${encodeURIComponent(fromDate)}`,
    { tags: { flow: "booking_common", endpoint: "service_next_availability" } },
  );
  if (nextRes.status !== 200) {
    return [];
  }

  const nextBody = nextRes.json();
  const nextDate = nextBody && nextBody.next && nextBody.next.date ? String(nextBody.next.date) : "";
  if (!nextDate) {
    return [];
  }

  const slotsRes = get(`/api/services/${encodeURIComponent(serviceSlug)}/slots?date=${encodeURIComponent(nextDate)}`, {
    tags: { flow: "booking_common", endpoint: "service_slots" },
  });
  if (slotsRes.status !== 200) {
    return [];
  }

  const slotsBody = slotsRes.json();
  const slots = slotsBody && Array.isArray(slotsBody.slots) ? slotsBody.slots : [];
  return slots
    .filter((slot) => Boolean(slot?.isAvailable) && Boolean(slot?.id))
    .map((slot) => String(slot.id));
}

function uniquePreservingOrder(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function resolveBookingSessionCandidates(input) {
  const maxCandidates = Math.max(1, Number(input.maxCandidates || 8));
  const nearest = collectNearestAvailabilityCandidates(input.serviceSlug);
  const seeded = collectSeedSessionCandidates(input.seed, maxCandidates);
  return uniquePreservingOrder([...nearest, ...seeded]).slice(0, maxCandidates);
}

function parseDraftCollisionCode(response) {
  const body = response.json();
  const code = body && body.code ? String(body.code) : "";
  if (code === "FULL_SESSION" || code === "DUPLICATE_BOOKING") {
    return code;
  }
  return null;
}

export function createDraftWithSessionFallback(input) {
  const attempted = [];
  let lastCollisionCode = "";

  for (const sessionId of input.sessionCandidates) {
    attempted.push(sessionId);
    const response = postJson(
      "/api/bookings/draft",
      {
        ...input.draftPayload,
        serviceSlug: input.serviceSlug,
        sessionId,
      },
      {
        tags: { flow: input.flowTag, endpoint: "booking_draft" },
      },
    );

    if (response.status === 201) {
      const body = response.json();
      const bookingId = body && body.draft && body.draft.bookingId ? String(body.draft.bookingId) : "";
      if (!bookingId) {
        throw new Error(`Draft succeeded without bookingId for flow='${input.flowTag}' sessionId='${sessionId}'.`);
      }
      return {
        bookingId,
        sessionId,
        attemptedSessionCount: attempted.length,
      };
    }

    const collisionCode = parseDraftCollisionCode(response);
    if (collisionCode) {
      lastCollisionCode = collisionCode;
      continue;
    }

    const body = response.json();
    const code = body && body.code ? String(body.code) : "UNKNOWN";
    const error = body && body.error ? String(body.error) : "Unexpected booking draft failure";
    throw new Error(
      `Draft failed for flow='${input.flowTag}' sessionId='${sessionId}' status=${response.status} code=${code} error='${error}'.`,
    );
  }

  throw new Error(
    `No valid booking candidate for flow='${input.flowTag}'. Attempted=${attempted.length}, lastCollision='${lastCollisionCode || "none"}'. ` +
      "Inventory appears exhausted or user/session collisions are too high for current seed.",
  );
}
