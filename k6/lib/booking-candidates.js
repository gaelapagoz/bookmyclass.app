import { get, postJson } from "./http.js";
import { Counter, Rate } from "k6/metrics";
import http from "k6/http";

const bookingDraftExpectedConflictRate = new Rate("booking_draft_expected_conflict_rate");
const bookingDraftTechnicalFailureRate = new Rate("booking_draft_technical_failure_rate");
const bookingDraftUnexpectedClientErrorRate = new Rate("booking_draft_unexpected_client_error_rate");
const bookingDraftExpectedConflictTotal = new Counter("booking_draft_expected_conflict_total");
const bookingDraftFullSessionSkipTotal = new Counter("booking_draft_full_session_skip_total");
const bookingDraftPastSessionSkipTotal = new Counter("booking_draft_past_session_skip_total");
const bookingDraftUnavailableSessionSkipTotal = new Counter("booking_draft_unavailable_session_skip_total");
const bookingDraftDuplicateSkipTotal = new Counter("booking_draft_duplicate_skip_total");

const bookingDraftExpectedStatuses = http.expectedStatuses(200, 201, 409);

function dateKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKeyFrom(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function getMonthKeyWithOffset(now, offset) {
  const shifted = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  return monthKeyFrom(shifted);
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
  if (!nextRes || nextRes.status !== 200) {
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
  if (!slotsRes || slotsRes.status !== 200) {
    return [];
  }

  const slotsBody = slotsRes.json();
  const slots = slotsBody && Array.isArray(slotsBody.slots) ? slotsBody.slots : [];
  return slots
    .filter((slot) => Boolean(slot?.isAvailable) && Boolean(slot?.id))
    .map((slot) => String(slot.id));
}

function collectMonthAvailabilityCandidates(serviceSlug, maxCandidates) {
  if (maxCandidates <= 0) {
    return [];
  }

  const monthSpan = Math.max(1, Number(__ENV.BOOKING_CANDIDATE_MONTH_SPAN || 2));
  const maxDates = Math.max(1, Number(__ENV.BOOKING_CANDIDATE_MAX_DATES || Math.max(6, maxCandidates)));
  const now = new Date();

  const availabilityDates = [];
  for (let monthOffset = 0; monthOffset < monthSpan && availabilityDates.length < maxDates; monthOffset += 1) {
    const monthKey = getMonthKeyWithOffset(now, monthOffset);
    const availabilityRes = get(
      `/api/services/${encodeURIComponent(serviceSlug)}/availability?month=${encodeURIComponent(monthKey)}`,
      {
        tags: { flow: "booking_common", endpoint: "service_availability" },
      },
    );
    if (!availabilityRes || availabilityRes.status !== 200) {
      continue;
    }

    const availabilityBody = availabilityRes.json();
    const days = availabilityBody && Array.isArray(availabilityBody.days) ? availabilityBody.days : [];
    for (const day of days) {
      if (!day?.hasAvailability || !day?.date) {
        continue;
      }
      availabilityDates.push(String(day.date));
      if (availabilityDates.length >= maxDates) {
        break;
      }
    }
  }

  if (!availabilityDates.length) {
    return [];
  }

  const sessionIds = [];
  for (const dateKey of availabilityDates) {
    const slotsRes = get(`/api/services/${encodeURIComponent(serviceSlug)}/slots?date=${encodeURIComponent(dateKey)}`, {
      tags: { flow: "booking_common", endpoint: "service_slots" },
    });
    if (!slotsRes || slotsRes.status !== 200) {
      continue;
    }

    const slotsBody = slotsRes.json();
    const slots = slotsBody && Array.isArray(slotsBody.slots) ? slotsBody.slots : [];
    for (const slot of slots) {
      if (!slot?.id || !slot?.isAvailable) {
        continue;
      }
      sessionIds.push(String(slot.id));
      if (sessionIds.length >= maxCandidates) {
        return sessionIds;
      }
    }
  }

  return sessionIds;
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
  const monthAvailability = collectMonthAvailabilityCandidates(input.serviceSlug, maxCandidates);
  const seeded = collectSeedSessionCandidates(input.seed, maxCandidates);
  return uniquePreservingOrder([...nearest, ...monthAvailability, ...seeded]).slice(0, maxCandidates);
}

function parseDraftSkippableCode(code) {
  if (
    code === "FULL_SESSION" ||
    code === "DUPLICATE_BOOKING" ||
    code === "PAST_SESSION" ||
    code === "UNAVAILABLE_SESSION"
  ) {
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
    let refreshedOnFullSession = false;

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
          responseCallback: bookingDraftExpectedStatuses,
        },
      );

      const body = response.json();
      const code = body && body.code ? String(body.code) : "";
      const skippableCode = parseDraftSkippableCode(code);
      const isExpectedConflict = response.status === 409 && code === "DUPLICATE_BOOKING";
      const isTechnicalFailure = response.status === 0 || response.status >= 500;
      const isExpectedBusinessClientResponse = Boolean(skippableCode);
      const isUnexpectedClientError =
        response.status >= 400 && response.status < 500 && !isExpectedBusinessClientResponse;

      bookingDraftExpectedConflictRate.add(isExpectedConflict, { flow: input.flowTag });
      bookingDraftTechnicalFailureRate.add(isTechnicalFailure, { flow: input.flowTag });
      bookingDraftUnexpectedClientErrorRate.add(isUnexpectedClientError, { flow: input.flowTag });
      if (isExpectedConflict) {
        bookingDraftExpectedConflictTotal.add(1, { flow: input.flowTag });
      }

      if (response.status === 200 || response.status === 201) {
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

      if (skippableCode) {
        lastSkippedCode = skippableCode;
        if (skippableCode === "FULL_SESSION") {
          bookingDraftFullSessionSkipTotal.add(1, { flow: input.flowTag });
        } else if (skippableCode === "PAST_SESSION") {
          bookingDraftPastSessionSkipTotal.add(1, { flow: input.flowTag });
        } else if (skippableCode === "UNAVAILABLE_SESSION") {
          bookingDraftUnavailableSessionSkipTotal.add(1, { flow: input.flowTag });
        } else if (skippableCode === "DUPLICATE_BOOKING") {
          bookingDraftDuplicateSkipTotal.add(1, { flow: input.flowTag });
        }

        // FULL_SESSION can indicate rapid inventory drift; refresh once early to avoid
        // hammering stale seeded IDs for the remainder of this iteration.
        if (
          skippableCode === "FULL_SESSION" &&
          !didRefreshCandidates &&
          typeof input.refreshCandidates === "function"
        ) {
          didRefreshCandidates = true;
          const refreshed = uniquePreservingOrder(input.refreshCandidates());
          candidates = refreshed.filter((candidateId) => !attempted.includes(candidateId));
          if (candidates.length > 0) {
            refreshedOnFullSession = true;
            break;
          }
        }

        continue;
      }

      const errorCode = code || "UNKNOWN";
      const error = body && body.error ? String(body.error) : "Unexpected booking draft failure";
      throw new Error(
        `Draft failed for flow='${input.flowTag}' sessionId='${sessionId}' status=${response.status} code=${errorCode} error='${error}'.`,
      );
    }

    if (refreshedOnFullSession) {
      continue;
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
