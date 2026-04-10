import { get, postJson } from "./http.js";
import { Counter, Rate } from "k6/metrics";
import http from "k6/http";

const bookingDraftExpectedConflictRate = new Rate("booking_draft_expected_conflict_rate");
const bookingDraftTechnicalFailureRate = new Rate("booking_draft_technical_failure_rate");
const bookingDraftUnexpectedClientErrorRate = new Rate("booking_draft_unexpected_client_error_rate");
const bookingDraftExpectedConflictTotal = new Counter("booking_draft_expected_conflict_total");
const bookingDraftFullSessionSkipTotal = new Counter("booking_draft_full_session_skip_total");
const bookingDraftInvalidSessionSkipTotal = new Counter("booking_draft_invalid_session_skip_total");
const bookingDraftPastSessionSkipTotal = new Counter("booking_draft_past_session_skip_total");
const bookingDraftUnavailableSessionSkipTotal = new Counter("booking_draft_unavailable_session_skip_total");
const bookingDraftDuplicateSkipTotal = new Counter("booking_draft_duplicate_skip_total");
const bookingDraftFullSessionCooldownHitTotal = new Counter("booking_draft_full_session_cooldown_hit_total");
const bookingEntitlementPrefilterSkipTotal = new Counter("booking_entitlement_prefilter_skip_total");
const bookingEntitlementPrefilterFailureTotal = new Counter("booking_entitlement_prefilter_failure_total");

const bookingDraftExpectedStatuses = http.expectedStatuses(200, 201, 409);
const fullSessionCooldownBySessionId = new Map();

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

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toSlotCandidate(slot, source, fallbackDate = "") {
  const id = slot?.id ? String(slot.id) : "";
  if (!id || !slot?.isAvailable) {
    return null;
  }

  return {
    id,
    source,
    dateKey: slot?.date ? String(slot.date) : fallbackDate,
    availableSpots: parsePositiveNumber(slot?.availableSpots, 1),
    capacity: parsePositiveNumber(slot?.capacity, 1),
  };
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
    .map((slot) => toSlotCandidate(slot, "nearest", nextDate))
    .filter((slot) => Boolean(slot));
}

function collectMonthAvailabilityCandidates(serviceSlug, maxCandidates) {
  if (maxCandidates <= 0) {
    return [];
  }

  const monthSpan = Math.max(1, Number(__ENV.BOOKING_CANDIDATE_MONTH_SPAN || 2));
  const maxDates = Math.max(1, Number(__ENV.BOOKING_CANDIDATE_MAX_DATES || Math.max(6, maxCandidates)));
  const collectionMultiplier = Math.max(
    2,
    Math.floor(parsePositiveNumber(__ENV.BOOKING_CANDIDATE_COLLECTION_MULTIPLIER, 6)),
  );
  const collectionLimit = Math.max(maxCandidates, maxCandidates * collectionMultiplier);
  const maxPerDate = Math.max(1, Math.floor(parsePositiveNumber(__ENV.BOOKING_CANDIDATE_MAX_PER_DATE, 3)));
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

  const candidates = [];
  for (const dateKey of availabilityDates) {
    const slotsRes = get(`/api/services/${encodeURIComponent(serviceSlug)}/slots?date=${encodeURIComponent(dateKey)}`, {
      tags: { flow: "booking_common", endpoint: "service_slots" },
    });
    if (!slotsRes || slotsRes.status !== 200) {
      continue;
    }

    const slotsBody = slotsRes.json();
    const slots = slotsBody && Array.isArray(slotsBody.slots) ? slotsBody.slots : [];
    let acceptedForDate = 0;
    for (const slot of slots) {
      if (acceptedForDate >= maxPerDate || candidates.length >= collectionLimit) {
        break;
      }

      const candidate = toSlotCandidate(slot, "month", dateKey);
      if (!candidate) {
        continue;
      }
      candidates.push(candidate);
      acceptedForDate += 1;
    }

    if (candidates.length >= collectionLimit) {
      break;
    }
  }

  return candidates;
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

function getFullSessionCooldownMs() {
  return Math.max(1_000, parsePositiveNumber(__ENV.BOOKING_FULL_SESSION_COOLDOWN_MS, 15 * 60_000));
}

function rememberFullSessionCooldown(sessionId) {
  fullSessionCooldownBySessionId.set(sessionId, Date.now() + getFullSessionCooldownMs());
}

function hasActiveFullSessionCooldown(sessionId) {
  const until = fullSessionCooldownBySessionId.get(sessionId);
  if (!until) {
    return false;
  }
  if (until <= Date.now()) {
    fullSessionCooldownBySessionId.delete(sessionId);
    return false;
  }
  return true;
}

function sourcePriority(source) {
  if (source === "nearest") {
    return 3;
  }
  if (source === "month") {
    return 2;
  }
  return 1;
}

function isLiveAvailabilitySource(source) {
  return source === "nearest" || source === "month";
}

function mergeByBestScore(candidates) {
  const bySessionId = new Map();
  for (const candidate of candidates) {
    const current = bySessionId.get(candidate.id);
    if (!current) {
      bySessionId.set(candidate.id, candidate);
      continue;
    }

    if (candidate.availableSpots > current.availableSpots) {
      bySessionId.set(candidate.id, candidate);
      continue;
    }

    if (
      candidate.availableSpots === current.availableSpots &&
      sourcePriority(candidate.source) > sourcePriority(current.source)
    ) {
      bySessionId.set(candidate.id, candidate);
    }
  }
  return [...bySessionId.values()];
}

function rankCandidatesByHeadroom(candidates) {
  const ranked = [...candidates].sort((left, right) => {
    if (left.availableSpots !== right.availableSpots) {
      return right.availableSpots - left.availableSpots;
    }

    if (left.capacity !== right.capacity) {
      return right.capacity - left.capacity;
    }

    const sourceDelta = sourcePriority(right.source) - sourcePriority(left.source);
    if (sourceDelta !== 0) {
      return sourceDelta;
    }

    if (left.dateKey !== right.dateKey) {
      return left.dateKey.localeCompare(right.dateKey);
    }

    return left.id.localeCompare(right.id);
  });

  return ranked;
}

function splitCandidatesByExclusion(candidates, flowTag = "booking_common") {
  const active = [];
  const excluded = [];

  for (const candidate of candidates) {
    if (!hasActiveFullSessionCooldown(candidate.id)) {
      active.push(candidate);
      continue;
    }

    // Allow a previously excluded session back only when live availability
    // explicitly reports it as available again.
    if (isLiveAvailabilitySource(candidate.source) && candidate.availableSpots > 0) {
      fullSessionCooldownBySessionId.delete(candidate.id);
      active.push(candidate);
      continue;
    }

    bookingDraftFullSessionCooldownHitTotal.add(1, { flow: flowTag });
    excluded.push(candidate);
  }

  return { active, excluded };
}

function spreadRankedCandidates(rankedCandidates, spreadSeed, maxCandidates) {
  if (!rankedCandidates.length || maxCandidates <= 0) {
    return [];
  }

  if (spreadSeed.startsWith("booking_common:")) {
    return rankedCandidates.slice(0, maxCandidates).map((candidate) => candidate.id);
  }

  if (String(__ENV.BOOKING_CANDIDATE_SPREAD_MODE || "").trim().toLowerCase() === "ranked") {
    return rankedCandidates.slice(0, maxCandidates).map((candidate) => candidate.id);
  }

  const spreadStep = Math.max(1, Math.floor(parsePositiveNumber(__ENV.BOOKING_CANDIDATE_SPREAD_STEP, 3)));
  const startIndex = normalizeIndex(stableHash(spreadSeed), rankedCandidates.length);
  const ordered = [];
  const seen = new Set();

  for (let offset = 0; offset < rankedCandidates.length; offset += 1) {
    const index = normalizeIndex(startIndex + offset * spreadStep, rankedCandidates.length);
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    ordered.push(rankedCandidates[index]);
  }

  if (ordered.length < rankedCandidates.length) {
    for (let index = 0; index < rankedCandidates.length; index += 1) {
      if (seen.has(index)) {
        continue;
      }
      ordered.push(rankedCandidates[index]);
    }
  }

  return ordered.slice(0, maxCandidates).map((candidate) => candidate.id);
}

function interleaveRankedCandidatesByDate(rankedCandidates) {
  if (rankedCandidates.length <= 1) {
    return rankedCandidates;
  }

  const seededCandidates = rankedCandidates.filter((candidate) => candidate.source === "seed");
  const nonSeedCandidates = rankedCandidates.filter((candidate) => candidate.source !== "seed");
  if (nonSeedCandidates.length <= 1) {
    return [...nonSeedCandidates, ...seededCandidates];
  }

  const dateOrder = [];
  const buckets = new Map();
  for (const candidate of nonSeedCandidates) {
    const bucketKey = candidate.dateKey || `seed:${candidate.id}`;
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
      dateOrder.push(bucketKey);
    }
    buckets.get(bucketKey).push(candidate);
  }

  const interleaved = [];
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    for (const bucketKey of dateOrder) {
      const bucket = buckets.get(bucketKey);
      if (!bucket || bucket.length === 0) {
        continue;
      }
      hasRemaining = true;
      interleaved.push(bucket.shift());
    }
  }

  return [...interleaved, ...seededCandidates];
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

export function resolveBookingSessionCandidatePool(input) {
  const maxCandidates = Math.max(1, Number(input.maxCandidates || 8));
  const nearest = collectNearestAvailabilityCandidates(input.serviceSlug);
  const monthAvailability = collectMonthAvailabilityCandidates(input.serviceSlug, maxCandidates * 2);
  const liveAvailableSessionIds = uniquePreservingOrder(
    [...nearest, ...monthAvailability].map((candidate) => candidate.id),
  );
  const seeded = collectSeedSessionCandidates(input.seed, maxCandidates).map((sessionId) => ({
    id: sessionId,
    source: "seed",
    dateKey: "",
    availableSpots: 1,
    capacity: 1,
  }));
  const merged = mergeByBestScore([...nearest, ...monthAvailability, ...seeded]);
  const { active } = splitCandidatesByExclusion(merged, input.flowTag || "booking_common");
  const ranked = rankCandidatesByHeadroom(active);
  const interleaved = interleaveRankedCandidatesByDate(ranked);
  const spreadSeed = `${input.flowTag || "booking_common"}:${input.serviceSlug}:${Math.max(0, Number(__VU) - 1)}:${Math.max(0, Number(__ITER))}`;
  return {
    sessionCandidates: spreadRankedCandidates(interleaved, spreadSeed, maxCandidates),
    liveAvailableSessionIds,
  };
}

export function resolveBookingSessionCandidates(input) {
  return resolveBookingSessionCandidatePool(input).sessionCandidates;
}

export function resolveEntitlementPrefilter(input) {
  const response = get(
    `/api/bookings/payment-options-preview?serviceSlug=${encodeURIComponent(input.serviceSlug)}&bookingIntent=USE_PLAN`,
    {
      tags: { flow: input.flowTag, endpoint: "booking_payment_options_preview" },
    },
  );

  if (!response || response.status !== 200) {
    bookingEntitlementPrefilterFailureTotal.add(1, {
      flow: input.flowTag,
      status: String(response?.status ?? 0),
    });
    const body = response && typeof response.json === "function" ? response.json() : null;
    const code = body && body.code ? String(body.code) : "UNKNOWN";
    const error = body && body.error ? String(body.error) : "Unexpected payment-options-preview failure";
    throw new Error(
      `Entitlement prefilter failed for flow='${input.flowTag}' service='${input.serviceSlug}' status=${response?.status ?? 0} code=${code} error='${error}'.`,
    );
  }

  const body = response.json();
  const existingPlans =
    body && body.paymentOptions && Array.isArray(body.paymentOptions.existingPlans) ? body.paymentOptions.existingPlans : [];
  if (existingPlans.length === 0) {
    bookingEntitlementPrefilterSkipTotal.add(1, { flow: input.flowTag });
    return {
      eligible: false,
      reason: "NO_EXISTING_PLAN_FOR_SERVICE_SCOPE",
      existingPlanCount: 0,
    };
  }

  return {
    eligible: true,
    reason: "HAS_EXISTING_PLAN",
    existingPlanCount: existingPlans.length,
  };
}

function parseDraftSkippableCode(code) {
  if (
    code === "FULL_SESSION" ||
    code === "INVALID_SESSION" ||
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
  const excludedSessionIds = new Set();
  const maxRefreshAttempts = Math.max(
    1,
    Math.floor(parsePositiveNumber(__ENV.BOOKING_CANDIDATE_REFRESH_MAX, 4)),
  );
  let refreshAttemptCount = 0;

  function refreshCandidatePool() {
    if (typeof input.refreshCandidates !== "function" || refreshAttemptCount >= maxRefreshAttempts) {
      return false;
    }
    refreshAttemptCount += 1;
    const refreshedResult = input.refreshCandidates({
      flowTag: input.flowTag,
      attemptedSessionIds: [...attempted],
      excludedSessionIds: [...excludedSessionIds],
    });
    const refreshedRaw = Array.isArray(refreshedResult)
      ? refreshedResult
      : refreshedResult?.sessionCandidates;
    const refreshed = uniquePreservingOrder(refreshedRaw || []);
    const liveAvailableSessionIds = uniquePreservingOrder(
      Array.isArray(refreshedResult?.liveAvailableSessionIds) ? refreshedResult.liveAvailableSessionIds : [],
    );
    const liveAvailableSet = new Set(liveAvailableSessionIds);
    for (const excludedId of [...excludedSessionIds]) {
      if (liveAvailableSet.has(excludedId)) {
        excludedSessionIds.delete(excludedId);
        fullSessionCooldownBySessionId.delete(excludedId);
      }
    }

    const refreshSet = new Set(refreshed);
    const freshUnattempted = refreshed.filter(
      (sessionId) => !attempted.includes(sessionId) && !excludedSessionIds.has(sessionId),
    );
    const existingUnattempted = candidates.filter(
      (sessionId) => !attempted.includes(sessionId) && !refreshSet.has(sessionId) && !excludedSessionIds.has(sessionId),
    );
    candidates = uniquePreservingOrder([...freshUnattempted, ...existingUnattempted]);
    return candidates.length > 0;
  }

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
          excludedSessionIds.add(sessionId);
          rememberFullSessionCooldown(sessionId);
        } else if (skippableCode === "INVALID_SESSION") {
          bookingDraftInvalidSessionSkipTotal.add(1, { flow: input.flowTag });
          excludedSessionIds.add(sessionId);
        } else if (skippableCode === "PAST_SESSION") {
          bookingDraftPastSessionSkipTotal.add(1, { flow: input.flowTag });
        } else if (skippableCode === "UNAVAILABLE_SESSION") {
          bookingDraftUnavailableSessionSkipTotal.add(1, { flow: input.flowTag });
        } else if (skippableCode === "DUPLICATE_BOOKING") {
          bookingDraftDuplicateSkipTotal.add(1, { flow: input.flowTag });
        }

        // FULL_SESSION/INVALID_SESSION can indicate rapid inventory drift;
        // refresh candidates immediately (bounded by BOOKING_CANDIDATE_REFRESH_MAX)
        // to favor fresh live availability.
        if ((skippableCode === "FULL_SESSION" || skippableCode === "INVALID_SESSION") && refreshCandidatePool()) {
          refreshedOnFullSession = true;
          break;
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

    if (refreshCandidatePool()) {
      continue;
    }

    break;
  }

  throw new Error(
    `No valid booking candidate for flow='${input.flowTag}'. Attempted=${attempted.length}, lastSkipped='${lastSkippedCode || "none"}'. ` +
      "Inventory appears exhausted or user/session collisions are too high for current seed.",
  );
}
