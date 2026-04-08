import { get, postJson } from "./http.js";
import { Counter, Rate } from "k6/metrics";

const bookingDraftExpectedConflictRate = new Rate("booking_draft_expected_conflict_rate");
const bookingDraftTechnicalFailureRate = new Rate("booking_draft_technical_failure_rate");
const bookingDraftUnexpectedClientErrorRate = new Rate("booking_draft_unexpected_client_error_rate");
const bookingDraftExpectedConflictTotal = new Counter("booking_draft_expected_conflict_total");

function bookingDraftResponseIsExpected(response) {
  return Boolean(response && (response.status === 201 || response.status === 409));
}

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

function stableHash(input) {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function rotateSessionCandidatesForActor(sessionCandidates, options = {}) {
  const candidates = uniquePreservingOrder(sessionCandidates);
  if (candidates.length <= 1) {
    return candidates;
  }

  const actorKey = String(options.actorKey || "").trim().toLowerCase();
  const flowTag = String(options.flowTag || "").trim().toLowerCase();
  if (!actorKey && !flowTag) {
    return candidates;
  }

  const actorSeed = `${flowTag}:${actorKey}`;
  const iterComponent = Math.max(0, Number(__ITER) || 0) * 17;
  const startIndex = normalizeIndex(stableHash(actorSeed) + iterComponent, candidates.length);
  if (startIndex === 0) {
    return candidates;
  }

  return [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)];
}

export function resolveBookingSessionCandidates(input) {
  const maxCandidates = Math.max(1, Number(input.maxCandidates || 8));
  const nearest = collectNearestAvailabilityCandidates(input.serviceSlug);
  const seeded = collectSeedSessionCandidates(input.seed, maxCandidates);
  return uniquePreservingOrder([...nearest, ...seeded]).slice(0, maxCandidates);
}

function parseDraftSkippableCode(code) {
  if (code === "FULL_SESSION" || code === "DUPLICATE_BOOKING" || code === "PAST_SESSION") {
    return code;
  }
  return null;
}

export function createDraftWithSessionFallback(input) {
  const attempted = [];
  let lastSkippedCode = "";
  let candidates = uniquePreservingOrder(input.sessionCandidates);
  let didRefreshCandidates = false;

  while (true) {
    for (const sessionId of candidates) {
      if (attempted.includes(sessionId)) {
        continue;
      }

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
          responseCallback: bookingDraftResponseIsExpected,
        },
      );

      const body = response.json();
      const code = body && body.code ? String(body.code) : "";
      const isExpectedConflict = response.status === 409 && code === "DUPLICATE_BOOKING";
      const isTechnicalFailure = response.status === 0 || response.status >= 500;
      const isUnexpectedClientError = response.status >= 400 && response.status < 500 && !isExpectedConflict;

      bookingDraftExpectedConflictRate.add(isExpectedConflict, { flow: input.flowTag });
      bookingDraftTechnicalFailureRate.add(isTechnicalFailure, { flow: input.flowTag });
      bookingDraftUnexpectedClientErrorRate.add(isUnexpectedClientError, { flow: input.flowTag });
      if (isExpectedConflict) {
        bookingDraftExpectedConflictTotal.add(1, { flow: input.flowTag });
      }

      if (response.status === 201) {
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

      const skippableCode = parseDraftSkippableCode(code);
      if (skippableCode) {
        lastSkippedCode = skippableCode;
        continue;
      }

      const errorCode = code || "UNKNOWN";
      const error = body && body.error ? String(body.error) : "Unexpected booking draft failure";
      throw new Error(
        `Draft failed for flow='${input.flowTag}' sessionId='${sessionId}' status=${response.status} code=${errorCode} error='${error}'.`,
      );
    }

    if (!didRefreshCandidates && typeof input.refreshCandidates === "function") {
      didRefreshCandidates = true;
      const refreshed = uniquePreservingOrder(input.refreshCandidates());
      candidates = refreshed.filter((sessionId) => !attempted.includes(sessionId));
      if (candidates.length > 0) {
        continue;
      }
    }

    break;
  }

  throw new Error(
    `No valid booking candidate for flow='${input.flowTag}'. Attempted=${attempted.length}, lastSkipped='${lastSkippedCode || "none"}'. ` +
      "Inventory appears exhausted or user/session collisions are too high for current seed.",
  );
}
