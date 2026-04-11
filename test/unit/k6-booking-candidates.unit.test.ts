import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const postJsonMock = vi.fn();
const rateAddMock = vi.fn();
const counterAddMock = vi.fn();

vi.mock("../../k6/lib/http.js", () => ({
  get: (...args: unknown[]) => getMock(...args),
  postJson: (...args: unknown[]) => postJsonMock(...args),
}));

vi.mock("k6/metrics", () => ({
  Rate: function Rate() {
    this.add = (...args: unknown[]) => rateAddMock(...args);
  },
  Counter: function Counter() {
    this.add = (...args: unknown[]) => counterAddMock(...args);
  },
}));

vi.mock("k6/http", () => ({
  default: {
    expectedStatuses: (..._args: unknown[]) => "expected-statuses-mock",
  },
}));

function mockResponse(status: number, body: unknown) {
  return {
    status,
    json: () => body,
  };
}

describe("k6 booking candidates helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    getMock.mockReset();
    postJsonMock.mockReset();
    rateAddMock.mockReset();
    counterAddMock.mockReset();
    (globalThis as unknown as { __VU: number }).__VU = 1;
    (globalThis as unknown as { __ITER: number }).__ITER = 0;
  });

  it("prioritizes nearest availability candidates ahead of seeded sessions", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_MONTH_SPAN: "1",
      BOOKING_CANDIDATE_MAX_DATES: "2",
    };

    getMock
      .mockReturnValueOnce(mockResponse(200, { next: { date: "2026-05-01" } }))
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [
            { id: "slot-nearest-1", isAvailable: true },
            { id: "slot-nearest-2", isAvailable: true },
          ],
        }),
      )
      .mockReturnValueOnce(
        mockResponse(200, {
          days: [
            { date: "2026-05-01", hasAvailability: true },
            { date: "2026-05-02", hasAvailability: true },
          ],
        }),
      )
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [{ id: "slot-month-1", isAvailable: true }],
        }),
      )
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [{ id: "slot-month-2", isAvailable: true }],
        }),
      );

    const { resolveBookingSessionCandidates } = await import("../../k6/lib/booking-candidates.js");
    const candidates = resolveBookingSessionCandidates({
      serviceSlug: "vinyasa-yoga",
      seed: { sessionIds: ["seed-1", "seed-2", "slot-nearest-1"] },
      maxCandidates: 5,
    });

    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBe("slot-nearest-1");
    expect(candidates).toContain("slot-nearest-2");
    expect(candidates).toContain("slot-month-1");
    expect(candidates).toContain("slot-month-2");
    expect(candidates).not.toContain("seed-1");
  });


  it("can include stale seeded sessions only when explicitly enabled", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_MONTH_SPAN: "1",
      BOOKING_CANDIDATE_MAX_DATES: "1",
      BOOKING_ALLOW_STALE_SEEDED_SESSION_IDS: "1",
    };

    getMock
      .mockReturnValueOnce(mockResponse(200, { next: null }))
      .mockReturnValueOnce(mockResponse(200, { days: [] }));

    const { resolveBookingSessionCandidates } = await import("../../k6/lib/booking-candidates.js");
    const candidates = resolveBookingSessionCandidates({
      serviceSlug: "vinyasa-yoga",
      seed: { sessionIds: ["seed-1"] },
      maxCandidates: 1,
    });

    expect(candidates).toEqual(["seed-1"]);
  });
  it("rotates candidate priority deterministically per flow+actor", async () => {
    const { rotateSessionCandidatesForActor } = await import("../../k6/lib/booking-candidates.js");

    (globalThis as unknown as { __ITER: number }).__ITER = 0;
    const rotatedA = rotateSessionCandidatesForActor(["s-1", "s-2", "s-3", "s-4"], {
      flowTag: "booking_checkout",
      actorKey: "k6-user-1@example.test",
    });

    (globalThis as unknown as { __ITER: number }).__ITER = 0;
    const rotatedARepeat = rotateSessionCandidatesForActor(["s-1", "s-2", "s-3", "s-4"], {
      flowTag: "booking_checkout",
      actorKey: "k6-user-1@example.test",
    });

    const rotatedB = rotateSessionCandidatesForActor(["s-1", "s-2", "s-3", "s-4"], {
      flowTag: "booking_checkout",
      actorKey: "k6-user-2@example.test",
    });

    expect(rotatedARepeat).toEqual(rotatedA);
    expect(rotatedB).not.toEqual(rotatedA);
    expect(rotatedA).toHaveLength(4);
    expect(new Set(rotatedA).size).toBe(4);
  });

  it("adds iteration component to avoid hammering the same first candidate every loop", async () => {
    const { rotateSessionCandidatesForActor } = await import("../../k6/lib/booking-candidates.js");

    (globalThis as unknown as { __ITER: number }).__ITER = 0;
    const iter0 = rotateSessionCandidatesForActor(["s-1", "s-2", "s-3", "s-4"], {
      flowTag: "booking_entitlement",
      actorKey: "k6-user@example.test",
    });

    (globalThis as unknown as { __ITER: number }).__ITER = 1;
    const iter1 = rotateSessionCandidatesForActor(["s-1", "s-2", "s-3", "s-4"], {
      flowTag: "booking_entitlement",
      actorKey: "k6-user@example.test",
    });

    expect(iter1).not.toEqual(iter0);
    expect(new Set(iter1).size).toBe(4);
  });

  it("retries draft creation on FULL_SESSION and DUPLICATE_BOOKING collisions", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(
        mockResponse(409, {
          code: "DUPLICATE_BOOKING",
          error: "You already have an active booking draft or booking for this session.",
        }),
      )
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-123" } }));

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["s-1", "s-2", "s-3"],
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(result.bookingId).toBe("booking-123");
    expect(result.sessionId).toBe("s-3");
    expect(result.attemptedSessionCount).toBe(3);
    expect(postJsonMock).toHaveBeenCalledTimes(3);
  });

  it("treats PAST_SESSION as stale candidate and continues to next candidate", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "PAST_SESSION", error: "Only future sessions can be booked." }))
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-fresh" } }));

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["stale-session", "fresh-session"],
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(result.bookingId).toBe("booking-fresh");
    expect(result.sessionId).toBe("fresh-session");
    expect(result.attemptedSessionCount).toBe(2);
  });

  it("treats UNAVAILABLE_SESSION as stale candidate and continues to next candidate", async () => {
    postJsonMock
      .mockReturnValueOnce(
        mockResponse(400, {
          code: "UNAVAILABLE_SESSION",
          error: "This session is not available for booking.",
        }),
      )
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-fallback" } }));

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["unavailable-session", "fallback-session"],
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(result.bookingId).toBe("booking-fallback");
    expect(result.sessionId).toBe("fallback-session");
    expect(result.attemptedSessionCount).toBe(2);
  });
  it("refreshes candidates once when initial list is exhausted by skippable results", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "PAST_SESSION", error: "Only future sessions can be booked." }))
      .mockReturnValueOnce(mockResponse(409, { code: "DUPLICATE_BOOKING", error: "Already booked." }))
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-refreshed" } }));

    const refreshCandidates = vi.fn(() => ["stale-session", "dup-session", "fresh-from-refresh"]);
    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_entitlement",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["stale-session", "dup-session"],
      refreshCandidates,
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "USE_PLAN",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(refreshCandidates).toHaveBeenCalledTimes(1);
    expect(result.bookingId).toBe("booking-refreshed");
    expect(result.sessionId).toBe("fresh-from-refresh");
    expect(result.attemptedSessionCount).toBe(3);
  });

  it("refreshes early after FULL_SESSION to avoid hammering stale candidate list", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-refreshed-fast" } }));

    const refreshCandidates = vi.fn(() => ["stale-session", "fresh-from-refresh"]);
    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["stale-session", "another-stale-session"],
      refreshCandidates,
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(refreshCandidates).toHaveBeenCalledTimes(1);
    expect(result.bookingId).toBe("booking-refreshed-fast");
    expect(result.sessionId).toBe("fresh-from-refresh");
    expect(result.attemptedSessionCount).toBe(2);
    expect(postJsonMock).toHaveBeenCalledTimes(2);
  });

  it("hard-excludes INVALID_SESSION and refreshes to a fresh live candidate", async () => {
    postJsonMock
      .mockReturnValueOnce(mockResponse(404, { code: "INVALID_SESSION", error: "Session was not found." }))
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-after-invalid-session-refresh" } }));

    const refreshCandidates = vi
      .fn()
      .mockReturnValueOnce({
        sessionCandidates: ["stale-session", "fresh-live-session"],
        liveAvailableSessionIds: ["fresh-live-session"],
      });

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_entitlement",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["stale-session"],
      refreshCandidates,
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "USE_PLAN",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(refreshCandidates).toHaveBeenCalledTimes(1);
    expect(result.bookingId).toBe("booking-after-invalid-session-refresh");
    expect(result.sessionId).toBe("fresh-live-session");
    expect(postJsonMock).toHaveBeenCalledTimes(2);
  });

  it("does not immediately recycle INVALID_SESSION ids unless live rediscovery re-admits them", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_REFRESH_MAX: "2",
    };

    postJsonMock
      .mockReturnValueOnce(mockResponse(404, { code: "INVALID_SESSION", error: "Session was not found." }))
      .mockReturnValueOnce(mockResponse(404, { code: "INVALID_SESSION", error: "Session was not found." }));

    const refreshCandidates = vi
      .fn()
      .mockReturnValueOnce(["invalid-a", "invalid-b"])
      .mockReturnValueOnce(["invalid-a", "invalid-b"]);

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    expect(() =>
      createDraftWithSessionFallback({
        flowTag: "booking_checkout",
        serviceSlug: "vinyasa-yoga",
        sessionCandidates: ["invalid-a", "invalid-b"],
        refreshCandidates,
        draftPayload: {
          customerName: "K6 User",
          customerEmail: "k6@example.test",
          customerPhone: "+32000000000",
          bookingIntent: "SINGLE_BOOKING",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
        },
      }),
    ).toThrow(/No valid booking candidate/);

    expect(postJsonMock).toHaveBeenCalledTimes(2);
    expect(refreshCandidates).toHaveBeenCalledTimes(2);
  });

  it("re-refreshes on repeated FULL_SESSION and selects a newly available fresh session", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_REFRESH_MAX: "4",
    };

    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(mockResponse(201, { draft: { bookingId: "booking-fresh-after-second-refresh" } }));

    const refreshCandidates = vi
      .fn()
      .mockReturnValueOnce(["still-full-session"])
      .mockReturnValueOnce({
        sessionCandidates: ["fresh-session-now-open", "still-full-session"],
        liveAvailableSessionIds: ["fresh-session-now-open"],
      });

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["initial-full-session"],
      refreshCandidates,
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(refreshCandidates).toHaveBeenCalledTimes(2);
    expect(result.bookingId).toBe("booking-fresh-after-second-refresh");
    expect(result.sessionId).toBe("fresh-session-now-open");
    expect(result.attemptedSessionCount).toBe(3);
  });
  it("does not recycle excluded FULL_SESSION ids when refresh returns the same poisoned pool", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_REFRESH_MAX: "2",
      BOOKING_FULL_SESSION_COOLDOWN_MS: "600000",
    };

    postJsonMock
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }))
      .mockReturnValueOnce(mockResponse(400, { code: "FULL_SESSION", error: "This session is full." }));

    const refreshCandidates = vi
      .fn()
      .mockReturnValueOnce(["full-a", "full-b"])
      .mockReturnValueOnce(["full-a", "full-b"]);

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    expect(() =>
      createDraftWithSessionFallback({
        flowTag: "booking_checkout",
        serviceSlug: "vinyasa-yoga",
        sessionCandidates: ["full-a", "full-b"],
        refreshCandidates,
        draftPayload: {
          customerName: "K6 User",
          customerEmail: "k6@example.test",
          customerPhone: "+32000000000",
          bookingIntent: "SINGLE_BOOKING",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
        },
      }),
    ).toThrow(/No valid booking candidate/);

    expect(postJsonMock).toHaveBeenCalledTimes(2);
    expect(refreshCandidates).toHaveBeenCalledTimes(2);
  });
  it("treats idempotent 200 draft responses as success", async () => {
    postJsonMock.mockReturnValueOnce(
      mockResponse(200, {
        draft: { bookingId: "booking-existing-123" },
      }),
    );

    const { createDraftWithSessionFallback } = await import("../../k6/lib/booking-candidates.js");
    const result = createDraftWithSessionFallback({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      sessionCandidates: ["s-1"],
      draftPayload: {
        customerName: "K6 User",
        customerEmail: "k6@example.test",
        customerPhone: "+32000000000",
        bookingIntent: "SINGLE_BOOKING",
        consentTermsAccepted: true,
        consentPrivacyAccepted: true,
      },
    });

    expect(result.bookingId).toBe("booking-existing-123");
    expect(result.sessionId).toBe("s-1");
    expect(result.attemptedSessionCount).toBe(1);
  });
  it("skips entitlement scenario draft attempt when no existing plan is available", async () => {
    getMock.mockReturnValueOnce(
      mockResponse(200, {
        paymentOptions: {
          existingPlans: [],
        },
      }),
    );

    const { resolveEntitlementPrefilter } = await import("../../k6/lib/booking-candidates.js");
    const result = resolveEntitlementPrefilter({
      flowTag: "booking_entitlement",
      serviceSlug: "vinyasa-yoga",
    });

    expect(result).toEqual({
      eligible: false,
      reason: "NO_EXISTING_PLAN_FOR_SERVICE_SCOPE",
      existingPlanCount: 0,
    });
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it("throws when entitlement prefilter endpoint fails", async () => {
    getMock.mockReturnValueOnce(
      mockResponse(400, {
        code: "BOOKING_NOT_FOUND",
        error: "Service was not found.",
      }),
    );

    const { resolveEntitlementPrefilter } = await import("../../k6/lib/booking-candidates.js");
    expect(() =>
      resolveEntitlementPrefilter({
        flowTag: "booking_entitlement",
        serviceSlug: "invalid-service",
      }),
    ).toThrow(/Entitlement prefilter failed/);
  });
  it("spreads ranked candidates deterministically across iterations", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_MONTH_SPAN: "1",
      BOOKING_CANDIDATE_MAX_DATES: "1",
      BOOKING_CANDIDATE_SPREAD_STEP: "2",
    };

    const queueAvailabilityResponses = () => {
      getMock
        .mockReturnValueOnce(mockResponse(200, { next: { date: "2026-05-01" } }))
        .mockReturnValueOnce(
          mockResponse(200, {
            slots: [
              { id: "slot-1", isAvailable: true, availableSpots: 8, capacity: 10 },
              { id: "slot-2", isAvailable: true, availableSpots: 7, capacity: 10 },
              { id: "slot-3", isAvailable: true, availableSpots: 6, capacity: 10 },
              { id: "slot-4", isAvailable: true, availableSpots: 5, capacity: 10 },
            ],
          }),
        )
        .mockReturnValueOnce(mockResponse(200, { days: [] }));
    };

    queueAvailabilityResponses();
    const { resolveBookingSessionCandidates } = await import("../../k6/lib/booking-candidates.js");
    const iter0 = resolveBookingSessionCandidates({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      seed: null,
      maxCandidates: 4,
    });

    (globalThis as unknown as { __ITER: number }).__ITER = 1;
    queueAvailabilityResponses();
    const iter1 = resolveBookingSessionCandidates({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      seed: null,
      maxCandidates: 4,
    });

    expect(iter0).not.toEqual(iter1);
    expect(new Set(iter0)).toEqual(new Set(iter1));
  });

  it("re-admits excluded sessions only when fresh live availability explicitly shows capacity", async () => {
    (globalThis as unknown as { __ENV?: Record<string, string> }).__ENV = {
      BOOKING_CANDIDATE_MONTH_SPAN: "1",
      BOOKING_CANDIDATE_MAX_DATES: "1",
      BOOKING_CANDIDATE_SPREAD_MODE: "ranked",
      BOOKING_FULL_SESSION_COOLDOWN_MS: "120000",
    };

    postJsonMock.mockReturnValueOnce(
      mockResponse(400, {
        code: "FULL_SESSION",
        error: "This session is full.",
      }),
    );

    const { createDraftWithSessionFallback, resolveBookingSessionCandidates } = await import("../../k6/lib/booking-candidates.js");

    expect(() =>
      createDraftWithSessionFallback({
        flowTag: "booking_checkout",
        serviceSlug: "vinyasa-yoga",
        sessionCandidates: ["hot-session"],
        draftPayload: {
          customerName: "K6 User",
          customerEmail: "k6@example.test",
          customerPhone: "+32000000000",
          bookingIntent: "SINGLE_BOOKING",
          consentTermsAccepted: true,
          consentPrivacyAccepted: true,
        },
      }),
    ).toThrow(/No valid booking candidate/);

    getMock
      .mockReturnValueOnce(mockResponse(200, { next: { date: "2026-05-01" } }))
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [
            { id: "cool-session", isAvailable: true, availableSpots: 4, capacity: 10 },
          ],
        }),
      )
      .mockReturnValueOnce(mockResponse(200, { days: [] }));

    const candidatesWithoutRecovery = resolveBookingSessionCandidates({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      seed: { sessionIds: ["hot-session"] },
      maxCandidates: 2,
    });

    expect(candidatesWithoutRecovery).toEqual(["cool-session"]);

    getMock
      .mockReturnValueOnce(mockResponse(200, { next: { date: "2026-05-02" } }))
      .mockReturnValueOnce(
        mockResponse(200, {
          slots: [
            { id: "hot-session", isAvailable: true, availableSpots: 9, capacity: 10 },
            { id: "cool-session", isAvailable: true, availableSpots: 4, capacity: 10 },
          ],
        }),
      )
      .mockReturnValueOnce(mockResponse(200, { days: [] }));

    const candidatesWithRecovery = resolveBookingSessionCandidates({
      flowTag: "booking_checkout",
      serviceSlug: "vinyasa-yoga",
      seed: { sessionIds: ["hot-session"] },
      maxCandidates: 2,
    });

    expect(candidatesWithRecovery).toContain("hot-session");
  });
});







