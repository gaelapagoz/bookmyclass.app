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

    expect(candidates).toEqual([
      "slot-nearest-1",
      "slot-nearest-2",
      "slot-month-1",
      "slot-month-2",
      "seed-1",
    ]);
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

    const refreshCandidates = vi.fn(() => ["fresh-from-refresh", "stale-session"]);
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
});

